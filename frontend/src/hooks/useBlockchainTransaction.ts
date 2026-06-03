import { useToast } from '@/src/context/ToastContext';

/**
 * Devuelve true si el string tiene pinta de ser una firma real de Solana
 * (base58, entre 86 y 88 caracteres). Los hashes sintéticos como
 * "deposit-sol-1-1780487318470" no pasan este filtro y no generan
 * enlace al explorador.
 */
function isRealTxSignature(hash: string): boolean {
  return /^[1-9A-HJ-NP-Za-km-z]{86,88}$/.test(hash);
}

export function useBlockchainTransaction() {
  const { addToast, removeToast } = useToast();

  const executeTransaction = async (
    transactionFn: () => Promise<string>,
    {
      pendingMessage = 'Processing transaction...',
      successMessage = 'Transaction confirmed!',
      errorMessage = 'Transaction failed',
      explorerUrl,
      suppressErrorToast = false,
    }: {
      pendingMessage?: string;
      successMessage?: string;
      errorMessage?: string;
      explorerUrl?: (txHash: string) => string;
      suppressErrorToast?: boolean;
    } = {}
  ) => {
    const toastId = addToast({
      type: 'pending',
      message: pendingMessage,
      duration: 0,
    });

    try {
      const txHash = await transactionFn();

      removeToast(toastId);

      // Solo mostramos el enlace al explorador cuando el hash es una firma real
      const explorerLink =
        explorerUrl && isRealTxSignature(txHash)
          ? explorerUrl(txHash)
          : undefined;

      addToast({
        type: 'success',
        message: successMessage,
        url: explorerLink,
        duration: 8000,
      });

      return txHash;
    } catch (error: any) {
      console.error('Transaction error:', error);
      removeToast(toastId);
      const message =
        typeof error === 'string' ? error : error?.message || errorMessage;
      if (!suppressErrorToast) {
        addToast({
          type: 'error',
          message,
          duration: 6000,
        });
      }
      throw error;
    }
  };

  return { executeTransaction };
}
