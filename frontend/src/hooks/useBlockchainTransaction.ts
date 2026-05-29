import { useToast } from '@/src/context/ToastContext';

/**
 * Hook para ejecutar transacciones blockchain y mostrar toast de estado
 * Soporta mostrar explorer URL automáticamente
 */
export function useBlockchainTransaction() {
  const { addToast, removeToast } = useToast();

  const executeTransaction = async (
    transactionFn: () => Promise<string>,
    {
      pendingMessage = 'Processing transaction...',
      successMessage = 'Transaction confirmed!',
      errorMessage = 'Transaction failed',
      explorerUrl,
    }: {
      pendingMessage?: string;
      successMessage?: string;
      errorMessage?: string;
      explorerUrl?: (txHash: string) => string;
    } = {}
  ) => {
    try {
      // Show pending toast
      const toastId = addToast({
        type: 'pending',
        message: pendingMessage,
        duration: 0, // Don't auto-remove pending toasts
      });

      // Execute transaction
      const txHash = await transactionFn();

      // Remove pending and show success
      removeToast(toastId);
      const explorerLink = explorerUrl ? explorerUrl(txHash) : undefined;
      addToast({
        type: 'success',
        message: successMessage,
        url: explorerLink,
        duration: 8000,
      });

      return txHash;
    } catch (error: any) {
      console.error('Transaction error:', error);
      addToast({
        type: 'error',
        message: errorMessage,
        duration: 6000,
      });
      throw error;
    }
  };

  return { executeTransaction };
}
