// example/index.ts
import { type FunctionComponent, render } from 'preact'
import { batch, signal } from '@preact/signals'
import { useCallback } from 'preact/hooks'
import { html } from 'htm/preact'
import { NBSP } from './constants.js'
import { type Signature, sign, bufferToBase64 } from '../src/index.js'
import Debug from '@substrate-system/debug'
const debug = Debug('webauthn:example')

const state = {
    signature: signal<null|Signature>(null),
    text: signal<null|string>(null),
    credentialId: signal<string|null>(localStorage.getItem('key_id')),
    credential: signal<null|PublicKeyCredential>(null),
    publicKey: signal<null|string>(null)
}

if (import.meta.env.DEV || import.meta.env.MODE === 'staging') {
    localStorage.setItem('DEBUG', 'webauthn,webauthn:*')
    // @ts-expect-error dev
    window.state = state
} else {
    localStorage.removeItem('DEBUG')
}

const Example:FunctionComponent<unknown> = function () {
    const submit = useCallback(async (ev:SubmitEvent) => {
        ev.preventDefault()
        const form = ev.target as HTMLFormElement
        const textarea = form.elements.namedItem('text') as HTMLTextAreaElement
        const text = textarea.value
        debug('submit', text)
        if (!text || !state.credentialId.value) return

        const [signature, credential] = await sign(text, state.credentialId.value)
        debug('the signature...', signature)

        batch(() => {
            state.signature.value = signature
            state.credential.value = credential
        })
    }, [])

    const createKey = useCallback(async (ev:SubmitEvent) => {
        ev.preventDefault()
        const challenge = window.crypto.getRandomValues(new Uint8Array(32))
        const userId = window.crypto.getRandomValues(new Uint8Array(16))

        const data:PublicKeyCredential = await navigator.credentials.create({
            publicKey: {
                challenge,
                rp: { name: 'My Local Demo' },
                user: {
                    id: userId,
                    name: 'nichoth',  // Can be anything
                    displayName: 'nichoth'
                },
                pubKeyCredParams: [{ alg: -7, type: 'public-key' }],  // ES256
                authenticatorSelection: {
                    authenticatorAttachment: 'platform',  // FORCES fingerprint/FaceID
                    userVerification: 'required'
                },
                timeout: 60000
            }
        }) as PublicKeyCredential

        debug('created a key...', data)

        // Need to save this key now. We will never see it again.
        const response = data.response as AuthenticatorAttestationResponse
        const pubKey = response.getPublicKey()
        if (!pubKey) throw new Error('not public key')
        localStorage.setItem('my_public_key', bufferToBase64(pubKey))

        localStorage.setItem('key_id', data?.id ?? 'null')
        batch(() => {
            state.credentialId.value = data?.id ?? null
            state.credential.value = data || null
        })
    }, [])

    const publicKey = useCallback((ev: MouseEvent) => {
        ev.preventDefault()
        debug('get the public key from storage')

        // Retrieve the key you saved during registration
        const savedKeyBase64 = localStorage.getItem('my_public_key')

        if (savedKeyBase64) {
            // Update the signal so the UI displays it
            state.publicKey.value = savedKeyBase64
        } else {
            debug('No public key found in localStorage. Did you create the key yet?')
        }
    }, [])

    return html`<div class="example">
        <h1>Webauthn Signatures</h1>

        <p>
            Create signatures of arbitrary data with a biometric authenticator.
            Pass in data via the <code>challenge</code> parameter,
            and get back an assertion object containing a signature.
        </p>

        <p>
            Call <code>navigator.credentials.get</code> with the credential ID
            and the buffer we want to sign.
        </p>

        <h3>Steps:</h3>
        <ol>
            <li>First need to create a keypair. See <a
                href="https://developer.mozilla.org/en-US/docs/Web/API/CredentialsContainer/create"
            ><code>navigator.credentials.create</code></a></li>
            <li>
                Then call <code>navigator.credentials.get(options)</code> with
                the hash of the data you want to sign. The hash is the
                "challenge" parameter.
            </li>
        </ol>

        ${state.credentialId.value ?
            html`
                <h2>The Credential id</h2>
                <pre>${JSON.stringify(state.credentialId.value, null, 2)}</pre>
            ` :
            html`
                <h2>Create a Key</h2>

                <form onSubmit=${createKey}>
                    <button type="submit">Create</button>
                </form>
            `
        }

        <h2>Signature</h2>
        <pre>
            ${JSON.stringify(state.signature.value, null, 2)}
        </pre>

        ${state.signature.value && html`
            <div class="controls">
                <button onClick=${publicKey} class="btn">Get Public Key</button>
            </div>

            ${state.publicKey.value && html`
                <pre>
                    ${state.publicKey.value}
                </pre>
            `}
        `}

        ${state.signature.value ?
            html`<p>
                To verify this signature on your server, you can't just check
                the signature against the data. You have to hash the${NBSP}
                <code>clientDataJSON</code>, append it to the${NBSP}
                <code>authenticatorData</code>, and then verify the signature
                against that combined blob using the Public Key.
            </p>
            <p>
                You get the public key from the Registration step.
                When you first "sign up" or "create the keypair" using${NBSP}
                <code>navigator.credentials.create()</code>, the browser
                returns a <code>PublicKeyCredential</code> object. You must
                extract the public key from this object and save it in
                your database.
            </p>
            <p>
                Most browsers (Chrome 113+, Safari, Firefox) now support a
                direct method to get the public key, <code>.getPublicKey()</code>.
            </p>
            ` :
            null
        }

        ${!state.signature.value ?
            html`
                <h2>Input Text</h2>
                <form onSubmit=${submit}>
                    <textarea required=${true} id="text" name="text"></textarea>

                    <div class="controls">
                        <button type="submit" class="btn">Submit</button>
                    </div>
                </form>
            ` :
            null
        }
    </div>`
}

render(html`<${Example} />`, document.getElementById('root')!)
