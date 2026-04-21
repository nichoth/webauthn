import { test } from '@substrate-system/tapzero'
import { sign, verify, bufferToBase64, base64ToBuffer } from '../src/index.js'

test('bufferToBase64 encodes an ArrayBuffer to a base64 string', t => {
    const bytes = new Uint8Array([72, 101, 108, 108, 111])  // "Hello"
    const result = bufferToBase64(bytes.buffer)
    t.equal(result, btoa('Hello'), 'should encode to correct base64')
})

test('base64ToBuffer decodes a base64 string back to ArrayBuffer', t => {
    const original = new Uint8Array([72, 101, 108, 108, 111])  // "Hello"
    const base64 = bufferToBase64(original.buffer)
    const restored = new Uint8Array(base64ToBuffer(base64))
    t.equal(restored.length, original.length, 'should have the same length')
    t.deepEqual(Array.from(restored), Array.from(original), 'bytes should match')
})

test('base64ToBuffer handles URL-safe base64', t => {
    // Craft bytes that produce + and / in standard base64
    const bytes = new Uint8Array([0xfb, 0xff, 0xfe])
    const standard = bufferToBase64(bytes.buffer)  // contains + and /
    const urlSafe = standard.replace(/\+/g, '-').replace(/\//g, '_')
    const restored = new Uint8Array(base64ToBuffer(urlSafe))
    t.deepEqual(Array.from(restored), Array.from(bytes),
        'URL-safe base64 should round-trip')
})

test('sign returns a Signature object with all required fields', async t => {
    t.plan(5)

    const dataToSign = 'hello webauthn'
    const setup = await createMockWebAuthnSetup(dataToSign)

    const originalGet = navigator.credentials.get.bind(navigator.credentials)
    navigator.credentials.get = async () => setup.mockAssertion

    try {
        const [signature] = await sign(dataToSign, setup.credentialId)
        t.ok(signature.id, 'signature should have an id')
        t.ok(signature.rawId, 'signature should have rawId')
        t.ok(signature.signature, 'signature should have a signature field')
        t.ok(signature.authenticatorData,
            'signature should have authenticatorData')
        t.ok(signature.clientDataJSON, 'signature should have clientDataJSON')
    } finally {
        navigator.credentials.get = originalGet
    }
})

test('verify returns true for a valid signature', async t => {
    t.plan(1)

    const dataToSign = 'hello webauthn'
    const setup = await createMockWebAuthnSetup(dataToSign)

    const originalGet = navigator.credentials.get.bind(navigator.credentials)
    navigator.credentials.get = async () => setup.mockAssertion

    try {
        const [signature] = await sign(dataToSign, setup.credentialId)
        const isValid = await verify(signature, setup.publicKeyDer)
        t.ok(isValid, 'signature should verify as valid')
    } finally {
        navigator.credentials.get = originalGet
    }
})

test('verify returns false for a tampered signature', async t => {
    t.plan(1)

    const dataToSign = 'hello webauthn'
    const setup = await createMockWebAuthnSetup(dataToSign)

    const originalGet = navigator.credentials.get.bind(navigator.credentials)
    navigator.credentials.get = async () => setup.mockAssertion

    try {
        const [signature] = await sign(dataToSign, setup.credentialId)

        // Flip the first byte of the signature to make it invalid
        const sigBytes = base64ToBuffer(signature.signature)
        const tampered = new Uint8Array(sigBytes)
        tampered[0] ^= 0xff
        const tamperedSig = {
            ...signature,
            signature: bufferToBase64(tampered.buffer)
        }

        const isValid = await verify(tamperedSig, setup.publicKeyDer)
        t.equal(isValid, false, 'tampered signature should not verify')
    } finally {
        navigator.credentials.get = originalGet
    }
})

test('all done', () => {
    // @ts-expect-error test
    window.testsFinished = true
})

async function sha256 (data:Uint8Array<ArrayBuffer>):Promise<ArrayBuffer> {
    return (await crypto.subtle.digest('SHA-256', data))
}

/**
 * Build a mock WebAuthn assertion using real Web Crypto keys and signatures
 * so that we can test sign() and verify() without real hardware.
 */
async function createMockWebAuthnSetup (dataToSign:string) {
    const encoder = new TextEncoder()

    // Generate a real EC P-256 key pair
    const keyPair = await crypto.subtle.generateKey(
        { name: 'ECDSA', namedCurve: 'P-256' },
        true,
        ['sign', 'verify']
    )

    // Export public key in SPKI (DER) format – same as getPublicKey() returns
    const publicKeyDer = await crypto.subtle.exportKey('spki', keyPair.publicKey)

    // Compute SHA-256 of the data (this is what sign() uses as the challenge)
    const dataBuffer = encoder.encode(dataToSign)
    const challengeBuffer = await sha256(dataBuffer)

    // Build authenticatorData: rpIdHash (32 B) + flags (1 B) + counter (4 B)
    const authenticatorData = crypto.getRandomValues(new Uint8Array(37))
    authenticatorData[32] = 0x05  // UP + UV flags

    // Build clientDataJSON matching what a browser would return
    const challengeBase64url = btoa(
        String.fromCharCode(...new Uint8Array(challengeBuffer))
    ).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '')

    const clientDataJSON = JSON.stringify({
        type: 'webauthn.get',
        challenge: challengeBase64url,
        origin: 'http://localhost',
        crossOrigin: false,
    })
    const clientDataJSONBuffer = encoder.encode(clientDataJSON)

    // Compute the data that WebAuthn signs: authData || SHA-256(clientDataJSON)
    const clientDataHash = await sha256(clientDataJSONBuffer)
    const signedData = new Uint8Array(
        authenticatorData.byteLength + clientDataHash.byteLength
    )
    signedData.set(authenticatorData, 0)
    signedData.set(new Uint8Array(clientDataHash), authenticatorData.byteLength)

    // Sign with the real EC private key
    const signatureBuffer = await crypto.subtle.sign(
        { name: 'ECDSA', hash: { name: 'SHA-256' } },
        keyPair.privateKey,
        signedData
    )

    // Generate a random credential ID
    const credentialIdBuffer = crypto.getRandomValues(new Uint8Array(32))
    const credentialId = btoa(String.fromCharCode(...credentialIdBuffer))
        .replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '')

    // Assemble the mock object whose shape matches PublicKeyCredential
    const mockAssertion = {
        id: credentialId,
        rawId: credentialIdBuffer.buffer as ArrayBuffer,
        type: 'public-key' as const,
        response: {
            signature: signatureBuffer,
            authenticatorData: authenticatorData.buffer as ArrayBuffer,
            clientDataJSON: clientDataJSONBuffer.buffer as ArrayBuffer,
            userHandle: null,
        },
        getClientExtensionResults: () => ({}),
    }

    return { keyPair, publicKeyDer, credentialId, mockAssertion }
}
