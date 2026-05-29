/**
 * Utilidades para Solana blockchain explorer URLs
 */

const DEVNET_EXPLORER = 'https://explorer.solana.com';

/**
 * Obtiene la URL del explorer para una transacción
 * @param txHash Hash de la transacción
 * @param cluster Cluster de Solana (devnet, testnet, mainnet-beta)
 * @returns URL del explorer
 */
export function getTxExplorerUrl(txHash: string, cluster: string = 'devnet'): string {
  return `${DEVNET_EXPLORER}/tx/${txHash}?cluster=${cluster}`;
}

/**
 * Obtiene la URL del explorer para una cuenta/wallet
 * @param address Dirección de la wallet
 * @param cluster Cluster de Solana
 * @returns URL del explorer
 */
export function getAddressExplorerUrl(address: string, cluster: string = 'devnet'): string {
  return `${DEVNET_EXPLORER}/address/${address}?cluster=${cluster}`;
}

/**
 * Obtiene la URL del explorer para un token
 * @param mint Dirección del mint del token
 * @param cluster Cluster de Solana
 * @returns URL del explorer
 */
export function getTokenExplorerUrl(mint: string, cluster: string = 'devnet'): string {
  return `${DEVNET_EXPLORER}/address/${mint}?cluster=${cluster}`;
}
