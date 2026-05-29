/**
 * EJEMPLO DE USO - Sistema de Toasts para Transacciones Blockchain
 * 
 * El sistema de toasts está disponible globalmente en toda la app.
 * Úsalo en cualquier componente que haga transacciones a la blockchain.
 */

import { useToast } from '@/src/context/ToastContext';
import { useBlockchainTransaction } from '@/src/hooks/useBlockchainTransaction';
import { getTxExplorerUrl } from '@/src/lib/explorer';

/**
 * OPCIÓN 1: Usar el hook useBlockchainTransaction (RECOMENDADO)
 * Este es el más fácil y automático.
 */
export function ExampleComponentOption1() {
  const { executeTransaction } = useBlockchainTransaction();

  const handleVote = async () => {
    try {
      await executeTransaction(
        async () => {
          // Tu función que retorna el tx hash
          const response = await fetch('/api/vote', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ proposal: 'xyz' })
          });
          const data = await response.json();
          return data.txHash;
        },
        {
          pendingMessage: 'Voting on proposal...',
          successMessage: 'Vote cast successfully!',
          errorMessage: 'Failed to cast vote',
          explorerUrl: (txHash) => getTxExplorerUrl(txHash, 'devnet')
        }
      );
    } catch (error) {
      console.error('Vote error:', error);
    }
  };

  return <button onClick={handleVote}>Vote</button>;
}

/**
 * OPCIÓN 2: Usar useToast directamente
 * Para más control manual
 */
export function ExampleComponentOption2() {
  const { addToast, removeToast } = useToast();

  const handleStake = async () => {
    // Mostrar toast pendiente
    const toastId = addToast({
      type: 'pending',
      message: 'Staking tokens...',
      duration: 0, // No auto-remove para pending
    });

    try {
      const response = await fetch('/api/stake', { method: 'POST' });
      const data = await response.json();
      
      // Remover el toast pendiente
      removeToast(toastId);
      
      // Mostrar success con URL
      addToast({
        type: 'success',
        message: 'Tokens staked successfully!',
        url: getTxExplorerUrl(data.txHash, 'devnet'),
        duration: 8000,
      });
    } catch (error) {
      removeToast(toastId);
      addToast({
        type: 'error',
        message: 'Staking failed',
        duration: 6000,
      });
    }
  };

  return <button onClick={handleStake}>Stake</button>;
}

/**
 * Toast Types:
 * - 'success': ✓ Operación completada exitosamente
 * - 'error':   ✗ Error en la operación
 * - 'pending': ⏳ Operación en proceso (auto-spinner)
 * - 'info':    ℹ Información general
 * 
 * Toast Options:
 * - message: string - Mensaje a mostrar (REQUERIDO)
 * - type: 'success' | 'error' | 'info' | 'pending' - Tipo de toast
 * - url: string - URL clickeable (aparecerá como "View on Explorer →")
 * - duration: number - Milisegundos antes de auto-remover (0 = no auto-remove)
 */
