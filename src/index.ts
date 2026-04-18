// import Debug from '@substrate-system/debug'
// const debug = Debug('webauthn')

export interface Signature {
    id:string;
    rawId:string;
    signature:string;
    authenticatorData:string;
    clientDataJSON:string;
}

/**
 * Signs arbitrary data using a WebAuthn credential by passing
 * the data's SHA-256 hash as the cryptographic challenge.
 */
export async function sign (
    dataToSign:string|ArrayBuffer,
    credentialIdBase64:string
):Promise<[Signature, PublicKeyCredential]> {
    // 1. Prepare the data: Convert string to buffer if necessary
    const encoder = new TextEncoder()
    const dataBuffer = (typeof dataToSign === 'string' ?
        encoder.encode(dataToSign) :
        dataToSign)

    // 2. Hash the data (SHA-256)
    // This hash becomes our "challenge"
    const hashBuffer = await window.crypto.subtle.digest('SHA-256', dataBuffer)

    // 3. Prepare the WebAuthn Request Options
    const credentialId = Uint8Array.from(
        // 1. Replace URL-safe characters back to standard Base64
        // 2. Add padding back if necessary (optional, but safer for atob)
        atob(credentialIdBase64.replace(/-/g, '+').replace(/_/g, '/')),
        c => c.charCodeAt(0)
    )

    const options:CredentialRequestOptions = {
        publicKey: {
            // The hash acts as the challenge
            challenge: hashBuffer,
            timeout: 60000,
            userVerification: 'preferred',
            allowCredentials: [{
                id: credentialId,
                type: 'public-key',
                transports: ['usb', 'ble', 'nfc', 'internal'],
            }],
        }
    }

    try {
        // 4. Trigger the browser's biometric/security key prompt
        const assertion = await navigator.credentials.get(options)

        if (!assertion || !(assertion instanceof PublicKeyCredential)) {
            throw new Error('The browser did not return a Public Key Credential.')
        }

        // 5. Extract the response components
        const response = assertion.response as AuthenticatorAssertionResponse

        return [{
            id: assertion.id,
            rawId: bufferToBase64(assertion.rawId),
            signature: bufferToBase64(response.signature),
            authenticatorData: bufferToBase64(response.authenticatorData),
            clientDataJSON: bufferToBase64(response.clientDataJSON),
        }, assertion]
    } catch (error) {
        console.error('WebAuthn Signing Error:', error)
        throw error
    }
}

/**
 * Helper to convert ArrayBuffers to Base64 strings for storage/transport
 */
export function bufferToBase64 (buffer:ArrayBuffer):string {
    const bytes = new Uint8Array(buffer)
    let binary = ''
    for (let i = 0; i < bytes.byteLength; i++) {
        binary += String.fromCharCode(bytes[i])
    }
    return window.btoa(binary)
}
