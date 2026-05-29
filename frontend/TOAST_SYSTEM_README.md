# 🔔 Sistema de Toasts para Transacciones Blockchain

## Descripción General

Se ha implementado un sistema global de toasts para mostrar el estado de las transacciones blockchain en toda la aplicación. Los toasts incluyen URLs clickeables del Solana Explorer para verificar las transacciones directamente.

## Componentes Creados

### 1. **ToastContext** (`src/context/ToastContext.tsx`)
- Contexto global para manejar estado de toasts
- Hook `useToast()` para acceder a toasts en cualquier componente
- Métodos: `addToast()`, `removeToast()`

### 2. **ToastContainer** (`src/components/layout/ToastContainer.tsx`)
- Componente que renderiza los toasts en la esquina inferior derecha
- Auto-remove basado en duración configurada
- Soporte para diferentes tipos: success, error, info, pending
- Animaciones suaves de entrada/salida

### 3. **useBlockchainTransaction** (`src/hooks/useBlockchainTransaction.ts`)
- Hook especializado para transacciones blockchain
- Maneja automáticamente: pending → success/error
- Genera URLs del explorer automáticamente
- Patrón recomendado para nuevo código

### 4. **Explorer Utils** (`src/lib/explorer.ts`)
- Utilities para generar URLs del Solana Explorer
- Soporta devnet, testnet, mainnet-beta
- Funciones: `getTxExplorerUrl()`, `getAddressExplorerUrl()`, `getTokenExplorerUrl()`

## Cómo Usar

### Opción 1: Hook `useBlockchainTransaction` (RECOMENDADO)

```typescript
import { useBlockchainTransaction } from '@/src/hooks/useBlockchainTransaction';
import { getTxExplorerUrl } from '@/src/lib/explorer';

export function VotingComponent() {
  const { executeTransaction } = useBlockchainTransaction();

  const handleVote = async () => {
    await executeTransaction(
      async () => {
        // Tu lógica que retorna el tx hash
        const response = await fetch('/api/vote', { method: 'POST' });
        const data = await response.json();
        return data.txHash; // Retorna el hash
      },
      {
        pendingMessage: 'Casting vote...',
        successMessage: 'Vote cast successfully!',
        errorMessage: 'Failed to cast vote',
        explorerUrl: (txHash) => getTxExplorerUrl(txHash, 'devnet')
      }
    );
  };

  return <button onClick={handleVote}>Vote</button>;
}
```

### Opción 2: Hook `useToast` (Control Manual)

```typescript
import { useToast } from '@/src/context/ToastContext';
import { getTxExplorerUrl } from '@/src/lib/explorer';

export function StakingComponent() {
  const { addToast, removeToast } = useToast();

  const handleStake = async () => {
    const toastId = addToast({
      type: 'pending',
      message: 'Staking tokens...',
      duration: 0, // No auto-remove
    });

    try {
      const response = await fetch('/api/stake', { method: 'POST' });
      const data = await response.json();
      
      removeToast(toastId);
      addToast({
        type: 'success',
        message: 'Staked successfully!',
        url: getTxExplorerUrl(data.txHash, 'devnet'),
        duration: 8000,
      });
    } catch (error) {
      removeToast(toastId);
      addToast({
        type: 'error',
        message: 'Staking failed',
      });
    }
  };

  return <button onClick={handleStake}>Stake</button>;
}
```

## Tipos de Toasts

```typescript
type Toast = {
  id: string;              // Auto-generado
  message: string;         // Texto a mostrar (REQUERIDO)
  type?: 'success' | 'error' | 'info' | 'pending'; // Tipo de toast
  url?: string;           // URL clickeable (aparecerá como "View on Explorer →")
  duration?: number;      // Milisegundos antes de auto-remover
};
```

### Duración por Defecto
- `success`: 8 segundos
- `error`: 6 segundos  
- `info`: 6 segundos
- `pending`: 0 (no auto-remove, hay que remover manualmente)

## Integración Completada

✅ **ToastProvider** envuelve toda la app en `main.tsx`  
✅ **ToastContainer** se renderiza en `App.tsx`  
✅ **Sistema completo** disponible en cualquier componente  

## Ejemplo Visual

```
┌─────────────────────────────────────────┐
│ ✓ Vote cast successfully!               │
│ View on Explorer →                      │
│                                    [✕]  │
└─────────────────────────────────────────┘
```

## Próximos Pasos

1. **Integrar en GovernanceView**: Usar `useBlockchainTransaction` en las acciones de votación
2. **Integrar en SettingsView**: Mostrar toasts al conectar/desconectar wallets
3. **Integrar en otros componentes**: Markets, Duels, Orders, Portfolio

## Archivos Modificados

- `src/main.tsx` - Agregado ToastProvider
- `src/App.tsx` - Agregado ToastContainer
- Nuevos archivos:
  - `src/context/ToastContext.tsx`
  - `src/components/layout/ToastContainer.tsx`
  - `src/hooks/useBlockchainTransaction.ts`
  - `src/lib/explorer.ts`

## Tips

- ⚠️ Siempre retorna el tx hash desde tu función en `executeTransaction`
- 💡 Usa `getTxExplorerUrl()` para generar URLs del explorer automáticamente
- 🎯 Para operaciones cortas, establece `duration: 0` en pending
- 🌐 Los toasts son stackables - puedes mostrar varios simultáneamente
