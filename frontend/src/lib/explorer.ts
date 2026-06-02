/**
 * Utilidades para Solana blockchain explorer URLs
 */

const EXPLORER_BASE = 'https://explorer.solana.com';
const DEFAULT_SOLANA_CLUSTER = (import.meta.env?.VITE_SOLANA_NETWORK as string) || 'devnet';

/**
 * Obtiene la URL del explorer para una transacción
 * @param txHash Hash de la transacción
 * @param cluster Cluster de Solana (devnet, testnet, mainnet-beta)
 * @returns URL del explorer
 */
export function getTxExplorerUrl(txHash: string, cluster: string = DEFAULT_SOLANA_CLUSTER): string {
  return `${EXPLORER_BASE}/tx/${txHash}?cluster=${cluster}`;
}

/**
 * Obtiene la URL del explorer para una cuenta/wallet
 * @param address Dirección de la wallet
 * @param cluster Cluster de Solana
 * @returns URL del explorer
 */
export function getAddressExplorerUrl(address: string, cluster: string = DEFAULT_SOLANA_CLUSTER): string {
  return `${EXPLORER_BASE}/address/${address}?cluster=${cluster}`;
}

/**
 * Obtiene la URL del explorer para un token
 * @param mint Dirección del mint del token
 * @param cluster Cluster de Solana
 * @returns URL del explorer
 */
export function getTokenExplorerUrl(mint: string, cluster: string = DEFAULT_SOLANA_CLUSTER): string {
  return `${EXPLORER_BASE}/address/${mint}?cluster=${cluster}`;
}
