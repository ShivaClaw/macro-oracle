// components/pmode/WalletBar.tsx
// Wallet connect UI: MetaMask, WalletConnect, Phantom
// Returns connected addresses to parent; pure UI component.

'use client'

import { useEffect, useState, useCallback } from 'react'

export type ConnectedWallet = {
  type: 'metamask' | 'walletconnect' | 'phantom' | 'manual'
  evmAddress?: string
  solanaAddress?: string
  label: string
}

type Props = {
  onConnect: (wallet: ConnectedWallet) => void
  onDisconnect: () => void
  connected: ConnectedWallet | null
}

// ── Ethereum helpers ──────────────────────────────────────────────────────

async function requestEvmAccounts(): Promise<string | null> {
  const eth = (window as unknown as { ethereum?: { request: (a: unknown) => Promise<string[]>; isMetaMask?: boolean } }).ethereum
  if (!eth) return null
  try {
    const accounts = await eth.request({ method: 'eth_requestAccounts' })
    return accounts[0] ?? null
  } catch {
    return null
  }
}

// ── Phantom helper ────────────────────────────────────────────────────────

async function requestPhantom(): Promise<string | null> {
  const sol = (window as unknown as {
    solana?: { connect: () => Promise<{ publicKey: { toString: () => string } }>; isPhantom?: boolean }
    phantom?: { solana?: { connect: () => Promise<{ publicKey: { toString: () => string } }> } }
  })
  const provider = sol.phantom?.solana ?? sol.solana
  if (!provider) return null
  try {
    const resp = await provider.connect()
    return resp.publicKey.toString()
  } catch {
    return null
  }
}

// ── WalletConnect (modal via @walletconnect/modal) ────────────────────────
// We load the modal lazily so it doesn't bust SSR / bundle

let wcModal: { openModal: () => Promise<void>; subscribeProvider: (cb: (p: unknown) => void) => void } | null = null

async function getWcModal(): Promise<typeof wcModal | null> {
  if (wcModal) return wcModal
  try {
    // Dynamic import so SSR doesn't blow up on missing window
    const { WalletConnectModal } = await import('@walletconnect/modal' as string) as unknown as {
      WalletConnectModal: new (opts: { projectId: string; chains: string[] }) => typeof wcModal
    }
    wcModal = new WalletConnectModal({
      projectId: '90367cb8e96091a5111b1b090b255c07',
      chains: ['eip155:1', 'eip155:8453']
    }) as unknown as typeof wcModal
    return wcModal
  } catch {
    return null
  }
}

// ── Component ─────────────────────────────────────────────────────────────

const BTN: React.CSSProperties = {
  display: 'inline-flex', alignItems: 'center', gap: 7,
  background: 'rgba(255,255,255,0.07)',
  border: '1px solid rgba(255,255,255,0.14)',
  color: 'rgba(255,255,255,0.88)',
  borderRadius: 8, padding: '7px 14px',
  fontSize: 13, fontWeight: 500, cursor: 'pointer',
  transition: 'background 0.12s, border-color 0.12s',
  whiteSpace: 'nowrap',
}

function truncate(addr: string) {
  return addr.slice(0, 6) + '…' + addr.slice(-4)
}

export default function WalletBar({ onConnect, onDisconnect, connected }: Props) {
  const [loading, setLoading] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [hasMetaMask, setHasMetaMask] = useState(false)
  const [hasPhantom, setHasPhantom] = useState(false)

  useEffect(() => {
    const win = window as unknown as {
      ethereum?: { isMetaMask?: boolean }
      solana?: { isPhantom?: boolean }
      phantom?: { solana?: unknown }
    }
    setHasMetaMask(Boolean(win.ethereum?.isMetaMask))
    setHasPhantom(Boolean(win.phantom?.solana ?? win.solana?.isPhantom))
  }, [])

  const connectMetaMask = useCallback(async () => {
    setLoading('metamask'); setError(null)
    const addr = await requestEvmAccounts()
    setLoading(null)
    if (!addr) { setError('MetaMask not found or user rejected'); return }
    onConnect({ type: 'metamask', evmAddress: addr, label: truncate(addr) })
  }, [onConnect])

  const connectPhantom = useCallback(async () => {
    setLoading('phantom'); setError(null)
    const addr = await requestPhantom()
    setLoading(null)
    if (!addr) { setError('Phantom not found or user rejected'); return }
    onConnect({ type: 'phantom', solanaAddress: addr, label: truncate(addr) })
  }, [onConnect])

  const connectWC = useCallback(async () => {
    setLoading('walletconnect'); setError(null)
    try {
      const modal = await getWcModal()
      if (!modal) { setError('WalletConnect failed to load'); setLoading(null); return }
      await modal.openModal()
      // Address is provided via provider subscription — handled externally
      setLoading(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'WalletConnect error')
      setLoading(null)
    }
  }, [])

  if (connected) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <span style={{
          display: 'inline-flex', alignItems: 'center', gap: 7,
          background: 'rgba(31,224,145,0.10)',
          border: '1px solid rgba(31,224,145,0.28)',
          borderRadius: 8, padding: '6px 12px', fontSize: 13, color: '#1FE091'
        }}>
          <span style={{ width: 7, height: 7, borderRadius: '50%', background: '#1FE091', flexShrink: 0 }} />
          {walletTypeLabel(connected.type)} · {connected.label}
          {connected.evmAddress && connected.solanaAddress && (
            <span style={{ opacity: 0.6, fontSize: 11 }}> + SOL</span>
          )}
        </span>
        <button style={{ ...BTN, fontSize: 12, opacity: 0.7 }} onClick={onDisconnect}>
          Disconnect
        </button>
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        <button
          style={{ ...BTN, opacity: hasMetaMask ? 1 : 0.5 }}
          onClick={connectMetaMask}
          disabled={loading === 'metamask'}
          title={hasMetaMask ? 'Connect MetaMask' : 'MetaMask not detected'}
        >
          <MetaMaskIcon />
          {loading === 'metamask' ? 'Connecting…' : 'MetaMask'}
        </button>

        <button
          style={BTN}
          onClick={connectWC}
          disabled={loading === 'walletconnect'}
        >
          <WCIcon />
          {loading === 'walletconnect' ? 'Opening…' : 'WalletConnect'}
        </button>

        <button
          style={{ ...BTN, opacity: hasPhantom ? 1 : 0.5 }}
          onClick={connectPhantom}
          disabled={loading === 'phantom'}
          title={hasPhantom ? 'Connect Phantom' : 'Phantom not detected'}
        >
          <PhantomIcon />
          {loading === 'phantom' ? 'Connecting…' : 'Phantom'}
        </button>
      </div>
      {error && <p style={{ margin: 0, fontSize: 12, color: '#FF5E5B' }}>{error}</p>}
    </div>
  )
}

function walletTypeLabel(type: ConnectedWallet['type']) {
  if (type === 'metamask') return 'MetaMask'
  if (type === 'walletconnect') return 'WalletConnect'
  if (type === 'phantom') return 'Phantom'
  return 'Manual'
}

// ── Mini SVG icons ────────────────────────────────────────────────────────

function MetaMaskIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 35 35" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M32.96 1L19.56 10.88l2.44-5.76L32.96 1z" fill="#E2761B" stroke="#E2761B" strokeWidth=".5"/>
      <path d="M2.04 1l13.28 9.97-2.32-5.85L2.04 1z" fill="#E4761B" stroke="#E4761B" strokeWidth=".5"/>
      <path d="M28.16 24.54l-3.56 5.45 7.62 2.1 2.19-7.42-6.25-.13z" fill="#E4761B" stroke="#E4761B" strokeWidth=".5"/>
      <path d="M1.6 24.67l2.17 7.42 7.62-2.1-3.56-5.45-6.23.13z" fill="#E4761B" stroke="#E4761B" strokeWidth=".5"/>
    </svg>
  )
}

function WCIcon() {
  return (
    <svg width="18" height="11" viewBox="0 0 40 25" fill="none">
      <path d="M8.19 4.88C14.72-1.63 25.28-1.63 31.81 4.88l.93.91c.3.3.3.78 0 1.08l-3.18 3.1a.39.39 0 01-.54 0l-1.28-1.26c-4.5-4.4-11.77-4.4-16.27 0L9.97 9.99a.39.39 0 01-.54 0L6.25 6.87a.75.75 0 010-1.08l1.94-1.91z" fill="#3B99FC"/>
      <path d="M35.29 8.37l2.84 2.77a.75.75 0 010 1.08L24.47 25a.77.77 0 01-1.08 0l-8.73-8.52a.2.2 0 00-.27 0l-8.73 8.52a.77.77 0 01-1.08 0L.92 12.22a.75.75 0 010-1.08l2.84-2.77a.77.77 0 011.08 0l8.73 8.53c.07.07.2.07.27 0l8.73-8.53a.77.77 0 011.08 0l8.73 8.53c.07.07.2.07.27 0l8.73-8.53a.77.77 0 011.08 0z" fill="#3B99FC"/>
    </svg>
  )
}

function PhantomIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 128 128" fill="none">
      <rect width="128" height="128" rx="28" fill="#AB9FF2"/>
      <path d="M110.6 64c0 26.4-21.4 47.8-47.8 47.8S15 90.4 15 64s21.4-47.8 47.8-47.8S110.6 37.6 110.6 64z" fill="#fff"/>
      <path d="M52 75.4c0 6.6-5.3 11.9-11.9 11.9S28.2 82 28.2 75.4s5.3-11.9 11.9-11.9S52 68.8 52 75.4z" fill="#AB9FF2"/>
      <path d="M100.2 75.4c0 6.6-5.3 11.9-11.9 11.9s-11.9-5.3-11.9-11.9 5.3-11.9 11.9-11.9 11.9 5.3 11.9 11.9z" fill="#AB9FF2"/>
    </svg>
  )
}
