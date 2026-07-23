/**
 * Typed application event bus.
 *
 * Replaces the bare `new EventTarget()` (which forced every call site to cast
 * handlers with `as any` and gave no payload typing). `on()` returns an
 * unsubscribe function so effects can clean up without re-deriving the handler
 * identity, and `emit()`/`on()` are keyed to {@link AppEvents} so payload shapes
 * are checked at compile time.
 */

export interface CryptoTxDetail {
  signature: string;
  link: string;
  wallet?: string;
}

export interface NavigateTabDetail {
  tab: string;
}

/**
 * The full set of app events and their payload types. Events fanned out from the
 * websocket carry server payloads we don't consume in a typed way yet, so their
 * detail is `unknown`; the two internally-emitted events are fully typed.
 */
export interface AppEvents {
  'market:created': unknown;
  'market:updated': unknown;
  'duel:created': unknown;
  'duel:accepted': unknown;
  'orderbook:updated': unknown;
  'portfolio:updated': unknown;
  'portfolio:updated:private': unknown;
  'dao:proposal-created': unknown;
  'dao:proposal-updated': unknown;
  'crypto:tx': CryptoTxDetail;
  'dev:reset': unknown;
  'navigate:tab': NavigateTabDetail;
}

export type AppEventName = keyof AppEvents;

const target = new EventTarget();

export const eventBus = {
  /**
   * Subscribe to an app event. Returns an unsubscribe function — call it in an
   * effect cleanup instead of re-passing the handler to removeEventListener.
   */
  on<K extends AppEventName>(type: K, handler: (detail: AppEvents[K]) => void): () => void {
    const listener = (event: Event) => handler((event as CustomEvent<AppEvents[K]>).detail);
    target.addEventListener(type, listener);
    return () => target.removeEventListener(type, listener);
  },

  /** Emit an app event with its typed payload. */
  emit<K extends AppEventName>(type: K, detail?: AppEvents[K]): void {
    target.dispatchEvent(new CustomEvent(type, { detail }));
  },
};
