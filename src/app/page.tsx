
'use client';
import { useEffect, useState } from 'react';
import { Connection, PublicKey } from '@solana/web3.js';
import { Program, AnchorProvider, web3, utils, Idl , BN } from '@project-serum/anchor';
import idl from '.././idl.js'; // Changed to .js

// Define Solana window interface for TypeScript
interface SolanaWindow extends Window {
  solana?: {
    isPhantom?: boolean;
    isConnected?: boolean;
    connect?: () => Promise<{ publicKey: { toString: () => string } }>;
    publicKey?: { toString: () => string };
  };
}

// Simple Error Boundary Component
function ErrorBoundary({ children }: { children: React.ReactNode }) {
  const [error, setError] = useState<string | null>(null);

  if (error) {
    return <div style={{ color: 'red' }}>Error: {error}</div>;
  }

  return <>{children}</>;
}

// Validate IDL structure
const idlData: Idl = idl;
console.log('IDL data loaded:', JSON.stringify(idlData, null, 2)); // Debug: Verify IDL content
let programID: PublicKey | null = null;

try {
  if (idlData?.address && typeof idlData.address === 'string') {
    programID = new PublicKey(idlData.address);
    console.log('Program ID initialized:', programID.toString()); // Debug
  } else {
    console.warn('IDL address is missing or invalid');
  }
  // Validate required IDL fields
  if (!idlData.instructions || !idlData.accounts || !idlData.types) {
    throw new Error('Invalid IDL structure: Missing instructions, accounts, or types');
  }
} catch (e) {
  console.warn('Could not construct programID or validate IDL:', e);
}

// Fallback program ID
const FALLBACK_PROGRAM_ID = 'GgEMjntpZKxcUxdkGkJzqkufYzdoSmezRJWHVTk3dr2h';

const network = "https://api.devnet.solana.com";
const opts = {
  preflightCommitment: "processed" as web3.Commitment,
};

const { SystemProgram } = web3;

export default function Home() {
  const [walletStatus, setWalletStatus] = useState<string | null>(null);
  const [isWalletConnected, setIsWalletConnected] = useState<boolean>(false);
  const [publicKey, setPublicKey] = useState<string | null>(null);

  console.log('Home component rendered'); // Debug: Confirm component mounts

  const getProvider = () => {
    const connection = new Connection(network, opts.preflightCommitment);
    const win = window as unknown as SolanaWindow;
    if (!win.solana || !win.solana.isPhantom) {
      throw new Error('Phantom wallet not available. Please install Phantom Wallet.');
    }
    if (!win.solana.isConnected || !win.solana.publicKey) {
      throw new Error('Wallet is not connected. Please connect the wallet first.');
    }
    const provider = new AnchorProvider(connection, win.solana as any, {
      preflightCommitment: opts.preflightCommitment,
    });
    console.log('Provider created, wallet public key:', provider.wallet.publicKey.toString()); // Debug
    return provider;
  };

  // Ensure the connected wallet has at least `minLamports` balance; auto-request airdrop on devnet.
  const ensureBalance = async (provider: AnchorProvider, minLamports: number) => {
    try {
      const conn = provider.connection;
      const pubkey = provider.wallet.publicKey;
      const balance = await conn.getBalance(pubkey);
      console.log('Current wallet balance (lamports):', balance);
      if (balance < minLamports) {
        console.log(`Balance below threshold. Requesting airdrop of ${minLamports} lamports...`);
        // Request airdrop and confirm (works on devnet/test validator)
        const sig = await conn.requestAirdrop(pubkey, minLamports);
        // Use 'confirmed' commitment for a more robust wait on devnet
        await conn.confirmTransaction(sig, 'confirmed' as web3.Commitment);
        // wait a tick for blockhash to propagate
        await new Promise((res) => setTimeout(res, 1000));
        const newBal = await conn.getBalance(pubkey);
        console.log('Airdrop complete. New balance (lamports):', newBal);
      }
    } catch (e) {
      console.warn('Airdrop/ensure balance failed:', e);
    }
  };

  // Function to connect to Phantom wallet
  const connectWallet = async () => {
    try {
      if (typeof window !== 'undefined') {
        const { solana } = window as SolanaWindow;
        if (solana && solana.isPhantom) {
          const response = await solana.connect?.();
          const pubKey = response?.publicKey.toString();
          setWalletStatus('Wallet connected successfully!');
          setIsWalletConnected(true);
          setPublicKey(pubKey || null);
          console.log('Wallet connected, public key:', pubKey); // Debug
        } else {
          setWalletStatus('Phantom wallet not found. Please install Phantom Wallet 👻');
          console.log('Phantom wallet not found for connection'); // Debug
        }
      }
    } catch (error) {
      console.error('Error connecting wallet:', error);
      setWalletStatus('Error connecting wallet: Please try again.');
    }
  };

  const createCampaign = async () => {
    try {
      if (!isWalletConnected || !publicKey) {
        throw new Error('Wallet is not connected. Please connect the wallet first.');
      }
      if (!idlData || !idlData.instructions || !idlData.accounts || !idlData.types) {
        throw new Error('Invalid IDL data. Please check idl.js.');
      }
      const provider = getProvider();
      const runtimeProgramID = programID ?? new PublicKey(FALLBACK_PROGRAM_ID);
      if (!runtimeProgramID) {
        throw new Error('Program ID is not available. Please check idl.js.');
      }
      const program = new Program(idlData, runtimeProgramID, provider);

      // Diagnostic logs: IDL-declared program id vs runtime program id
      // Log declared program id (if present in the JS IDL file). `Idl` type doesn't include `address`, so cast to any.
      console.log('IDL declared program id:', (idlData as any).address ?? 'none');
      console.log('Using runtime program id:', runtimeProgramID.toString());
      try {
        console.log('Program.programId:', program.programId.toString());
      } catch (e) {
        // ignore
      }

      const [campaign] = await PublicKey.findProgramAddress(
        [
          utils.bytes.utf8.encode("CAMPAIGN_DEMO"),
          provider.wallet.publicKey.toBuffer(),
        ],
        runtimeProgramID
      );

      // Ensure the payer has enough SOL (0.1 SOL) to create the account / pay rent.
      // Adjust threshold as needed depending on your program's account size.
      const thresholdLamports = Math.floor(0.1 * web3.LAMPORTS_PER_SOL);
      await ensureBalance(provider, thresholdLamports);

      // Retry loop to work around transient 'Blockhash not found' simulation errors.
      const maxAttempts = 4;
      let attempt = 0;
      let lastErr: any = null;
      // Extra diagnostics: check whether the program account exists on-chain and log program ids
      try {
        const declaredId = (idlData as any)?.address ?? 'none';
        const runtimeId = runtimeProgramID.toString();
        console.log('Diagnostics before RPC: IDL.address =', declaredId, ', runtimeProgramID =', runtimeId);
        try {
          console.log('Program.programId (from Program instance) =', program.programId.toString());
        } catch (e) {
          // ignore
        }
        // Type diagnostics
        console.log('Types:', 'typeof IDL.address =', typeof (idlData as any)?.address, ', typeof runtimeProgramID =', typeof runtimeProgramID, ', runtimeProgramID instanceof PublicKey =', runtimeProgramID instanceof PublicKey);
        try {
          // program.programId may be a PublicKey; check type
          console.log('typeof program.programId =', typeof (program as any).programId, ', program.programId instanceof PublicKey =', (program as any).programId instanceof PublicKey);
        } catch (e) {
          // ignore
        }
        // Check on-chain whether an account exists at runtimeProgramID
        const pInfo = await provider.connection.getAccountInfo(runtimeProgramID);
        console.log('On-chain program account info for runtimeProgramID:', pInfo ? 'exists' : 'missing/null', pInfo);
      } catch (diagErr) {
        console.warn('Program diagnostics failed:', diagErr);
      }
      while (attempt < maxAttempts) {
        attempt += 1;
        try {
          await program.rpc.create("My First Campaign", "This is my first campaign", {
            accounts: {
              campaign: campaign,
              user: provider.wallet.publicKey,
              systemProgram: SystemProgram.programId,
              system_program: SystemProgram.programId,
            },
          });
          lastErr = null;
          break;
        } catch (e) {
          lastErr = e;
          const msg = (e as any)?.message || '';
          console.warn(`Attempt ${attempt} failed:`, msg);
          // If blockhash not found, wait and try again; refresh recent blockhash via getLatestBlockhash
          if (msg.includes('Blockhash not found') || msg.includes('blockhash expired')) {
            try {
              const latest = await provider.connection.getLatestBlockhash('confirmed');
              await provider.connection.confirmTransaction({ signature: latest.lastValidBlockHeight as unknown as string, ...latest } as any);
            } catch (inner) {
              // ignore; just sleep
            }
            await new Promise((res) => setTimeout(res, 800 * attempt));
            continue;
          }
          break;
        }
      }
      if (lastErr) throw lastErr;
      console.log("Campaign created with address:", campaign.toString());
      setWalletStatus('Campaign created successfully! Address: ' + campaign.toString());
    } catch (error) {
      console.error('Error creating campaign:', error);
      // Detect Anchor DeclaredProgramIdMismatch (code 4100) and show helpful guidance
      const anyErr = error as any;
      const isDeclaredMismatch =
        anyErr?.error?.code === 4100 ||
        (anyErr?.name === 'AnchorError' && (anyErr?.error?.name === 'DeclaredProgramIdMismatch' || (anyErr?.message || '').includes('DeclaredProgramIdMismatch')));
      if (isDeclaredMismatch) {
        console.error('DeclaredProgramIdMismatch detected. IDL-declared program id may not match the program you are calling.');
        console.log('IDL declared address:', (idlData as any)?.address ?? 'none');
        const usedRuntimeId = (programID ?? new PublicKey(FALLBACK_PROGRAM_ID)).toString();
        console.log('Runtime program id used:', usedRuntimeId);
        setWalletStatus('Error creating campaign: DeclaredProgramIdMismatch. Check `src/idl.js` address or use the correct program id.');
      } else if ((anyErr?.message || '').includes('User rejected') || (anyErr?.message || '').includes('User rejected the request')) {
        setWalletStatus('Transaction cancelled by user. Please approve the transaction in your wallet.');
      } else {
        setWalletStatus('Error creating campaign: ' + (error as Error).message);
      }
    }
  };

  const renderConnectedContainer = () => {
    return (
      <div>
        <button
          onClick={createCampaign}
          style={{
            padding: '10px 20px',
            backgroundColor: '#28a745',
            color: 'white',
            border: 'none',
            borderRadius: '5px',
            cursor: 'pointer',
            marginTop: '10px',
          }}
        >
          Create Campaign
        </button>
      </div>
    );
  };

  const renderNotConnectedContainer = () => {
    return (
      <button
        onClick={connectWallet}
        style={{
          padding: '10px 20px',
          backgroundColor: '#0070f3',
          color: 'white',
          border: 'none',
          borderRadius: '5px',
          cursor: 'pointer',
        }}
      >
        Connect to Wallet
      </button>
    );
  };

  useEffect(() => {
    console.log('useEffect running'); // Debug: Confirm useEffect runs

    const checkIfWalletIsConnected = async () => {
      console.log('Checking wallet connection'); // Debug: Confirm function runs
      try {
        if (typeof window !== 'undefined') {
          const { solana } = window as SolanaWindow;
          if (solana && solana.isPhantom) {
            console.log('Phantom wallet found!'); // Debug
            if (solana.isConnected && solana.publicKey) {
              const pubKey = solana.publicKey.toString();
              setWalletStatus('Phantom wallet found and connected!');
              setIsWalletConnected(true);
              setPublicKey(pubKey);
              console.log('Wallet already connected, public key:', pubKey); // Debug
            } else {
              setWalletStatus('Phantom wallet found but not connected.');
              setIsWalletConnected(false);
            }
          } else {
            console.log('Phantom wallet not found'); // Debug
            setWalletStatus('Phantom wallet not found. Please install Phantom Wallet 👻');
            setIsWalletConnected(false);
          }
        } else {
          console.log('Window undefined'); // Debug: Should not happen in client component
        }
      } catch (error) {
        console.error('Error checking wallet connection:', error);
        setWalletStatus('Error checking wallet connection. Please try again.');
        setIsWalletConnected(false);
      }
    };

    checkIfWalletIsConnected(); // Run on mount

    const onLoad = () => {
      console.log('Window load event fired'); // Debug
      checkIfWalletIsConnected();
    };
    window.addEventListener('load', onLoad);
    return () => window.removeEventListener('load', onLoad);
  }, []);

  return (
    <ErrorBoundary>
      <div style={{ padding: '20px', textAlign: 'center' }}>
        <h1>Next.js Solana Campaign App</h1>
        {walletStatus && <p>{walletStatus}</p>}
        {isWalletConnected && publicKey && (
          <p>Connected Public Key: {publicKey}</p>
        )}
        {isWalletConnected ? renderConnectedContainer() : renderNotConnectedContainer()}
        <p>Check the browser console for debug logs.</p>
      </div>
    </ErrorBoundary>
  );
}