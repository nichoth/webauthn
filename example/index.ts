// example/index.ts
import { type FunctionComponent, render } from 'preact'
import { batch, signal } from '@preact/signals'
import { useCallback, useRef } from 'preact/hooks'
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
    publicKey: signal<null|string>(null),
    hash: signal<null|string>(null),
    dataBuffer: signal<null|ArrayBuffer>(null),
    file: signal<null|File>(null),
    dragOver: signal<boolean>(false),
}

if (import.meta.env.DEV || import.meta.env.MODE === 'staging') {
    localStorage.setItem('DEBUG', 'webauthn,webauthn:*')
    // @ts-expect-error dev
    window.state = state
} else {
    localStorage.removeItem('DEBUG')
}

const Example:FunctionComponent<unknown> = function () {
    const textareaRef = useRef<HTMLTextAreaElement>(null)

    const computeHash = useCallback(async (ev:SubmitEvent) => {
        ev.preventDefault()
        const text = textareaRef.current?.value ?? ''
        const source = state.file.value ?? text
        if (!source) return

        let dataBuffer: ArrayBuffer
        if (state.file.value) {
            dataBuffer = await state.file.value.arrayBuffer()
        } else {
            dataBuffer = new TextEncoder().encode(text)
        }

        const hashBuffer = await window.crypto.subtle.digest('SHA-256', dataBuffer)
        const hashBase64 = bufferToBase64(hashBuffer)
        debug('computed hash', hashBase64)

        batch(() => {
            state.hash.value = hashBase64
            state.dataBuffer.value = dataBuffer
            state.text.value = state.file.value ? state.file.value.name : text
        })
    }, [])

    const submit = useCallback(async (ev:MouseEvent) => {
        ev.preventDefault()
        if (!state.credentialId.value || !state.dataBuffer.value) return

        debug('submit using stored data buffer')

        const [signature, credential] = await sign(state.dataBuffer.value, state.credentialId.value)
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
            state.publicKey.value = bufferToBase64(pubKey)
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

    const onDragOver = useCallback((ev:DragEvent) => {
        ev.preventDefault()
        state.dragOver.value = true
    }, [])

    const onDragLeave = useCallback(() => {
        state.dragOver.value = false
    }, [])

    const onDrop = useCallback((ev:DragEvent) => {
        ev.preventDefault()
        state.dragOver.value = false
        const file = ev.dataTransfer?.files?.[0]
        if (file) {
            batch(() => {
                state.file.value = file
                state.hash.value = null
                state.dataBuffer.value = null
            })
            debug('file dropped', file.name)
        }
    }, [])

    const onFileInput = useCallback((ev:Event) => {
        const input = ev.target as HTMLInputElement
        const file = input.files?.[0]
        if (file) {
            batch(() => {
                state.file.value = file
                state.hash.value = null
                state.dataBuffer.value = null
            })
            debug('file selected', file.name)
        }
    }, [])

    const clearFile = useCallback((ev:MouseEvent) => {
        ev.preventDefault()
        batch(() => {
            state.file.value = null
            state.hash.value = null
            state.dataBuffer.value = null
        })
    }, [])

    return html`<div class="example">
        <h1>Webauthn Signatures</h1>

        <p>
            Create signatures of arbitrary data with a biometric authenticator.
            The data is first hashed with${NBSP}<strong>SHA-256</strong>, and
            that hash becomes the <code>challenge</code> passed to${NBSP}
            <code>navigator.credentials.get</code>.
            You are always signing the <em>hash</em> of your data, not the raw
            data itself.
        </p>

        <h3>Steps:</h3>
        <ol>
            <li>First need to create a keypair. See <a
                href="https://developer.mozilla.org/en-US/docs/Web/API/CredentialsContainer/create"
            ><code>navigator.credentials.create</code></a></li>
            <li>Enter text or drop a file below, then click${NBSP}
                <strong>Hash</strong> to compute the SHA-256 hash.</li>
            <li>
                Click <strong>Sign the hash</strong> to pass the hash as the
                challenge to <code>navigator.credentials.get()</code> and get
                back a signature.
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

        ${!state.signature.value ?
            html`
                <h2>Step 1 — Enter data</h2>
                <p>Type some text <em>or</em> drag-and-drop a file below.</p>

                <form onSubmit=${computeHash}>
                    <textarea
                        ref=${textareaRef}
                        id="text"
                        name="text"
                        placeholder="Type something to hash and sign…"
                        disabled=${!!state.file.value}
                    ></textarea>

                    <div
                        class=${'drop-zone' + (state.dragOver.value ? ' drag-over' : '') + (state.file.value ? ' has-file' : '')}
                        onDragOver=${onDragOver}
                        onDragLeave=${onDragLeave}
                        onDrop=${onDrop}
                    >
                        ${state.file.value ?
                            html`
                                <span class="drop-zone-file">
                                    📄${NBSP}<strong>${state.file.value.name}</strong>
                                    ${NBSP}(${state.file.value.size.toLocaleString()} bytes)
                                </span>
                                <button class="btn-remove" onClick=${clearFile}>✕ Remove</button>
                            ` :
                            html`
                                <span>Drop a file here</span>
                                <span class="drop-zone-or">or</span>
                                <label class="btn-file-pick">
                                    Browse
                                    <input
                                        type="file"
                                        style="display:none"
                                        onChange=${onFileInput}
                                    />
                                </label>
                            `
                        }
                    </div>

                    <div class="controls">
                        <button type="submit" class="btn">
                            Hash (SHA-256)
                        </button>
                    </div>
                </form>

                ${state.hash.value ?
                    html`
                        <h2>Step 2 — SHA-256 hash (base64)</h2>
                        <p>
                            This is the hash of your input. This exact value
                            will be used as the <code>challenge</code> when
                            calling <code>navigator.credentials.get()</code>.
                            You are signing <em>this hash</em>, not the
                            original data.
                        </p>
                        <pre class="hash-display">${state.hash.value}</pre>

                        <h2>Step 3 — Sign the hash</h2>
                        <p>
                            Click the button below to pass the hash above as
                            the WebAuthn challenge and produce a${NBSP}
                            <strong>cryptographic signature</strong>.
                        </p>
                        <div class="controls">
                            <button
                                class="btn"
                                onClick=${submit}
                                disabled=${!state.credentialId.value}
                            >
                                Sign the hash ✍
                            </button>
                        </div>
                    ` :
                    null
                }
            ` :
            null
        }

        ${state.signature.value ?
            html`
                <h2>Signature</h2>
                <p>
                    The hash <code>${state.hash.value}</code> was signed
                    using your WebAuthn credential.
                </p>
                <pre>
                    ${JSON.stringify(state.signature.value, null, 2)}
                </pre>

                <div class="controls">
                    <button onClick=${publicKey} class="btn">Get Public Key</button>
                </div>

                ${state.publicKey.value && html`
                    <pre>
                        ${state.publicKey.value}
                    </pre>
                `}

                <p>
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
    </div>`
}

render(html`<${Example} />`, document.getElementById('root')!)
