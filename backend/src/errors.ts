/**
 * Errores de dominio con su propio código HTTP.
 *
 * El error handler global (server.ts) infería el status a partir de subcadenas
 * del mensaje en inglés (.includes('insufficient'), etc.) — un patrón "FRAGILE
 * BY DESIGN": cualquier throw nuevo o reescrito caía silenciosamente a 500, y a
 * la inversa un mensaje que por casualidad contuviera una palabra clave se
 * exponía como 400. Informe BAJA-3.
 *
 * A partir de aquí, el código NUEVO debe lanzar un DomainError (o una de sus
 * subclases) que lleve su propio statusCode; el handler lo respeta directamente
 * y no depende del texto. El match por texto se mantiene solo como fallback para
 * los muchos throws de string ya existentes, y debería ir desapareciendo.
 */
export class DomainError extends Error {
  readonly statusCode: number;
  /** Si false, el cliente recibe un mensaje genérico (para 5xx que no deben filtrar internals). */
  readonly expose: boolean;

  constructor(message: string, statusCode = 400, expose = true) {
    super(message);
    this.name = new.target.name;
    this.statusCode = statusCode;
    this.expose = expose;
    // Mantiene un stack trace limpio en V8.
    if (typeof (Error as any).captureStackTrace === 'function') {
      (Error as any).captureStackTrace(this, new.target);
    }
  }
}

export class BadRequestError extends DomainError {
  constructor(message: string) { super(message, 400); }
}
export class UnauthorizedError extends DomainError {
  constructor(message: string) { super(message, 401); }
}
export class ForbiddenError extends DomainError {
  constructor(message: string) { super(message, 403); }
}
export class NotFoundError extends DomainError {
  constructor(message: string) { super(message, 404); }
}
export class ConflictError extends DomainError {
  constructor(message: string) { super(message, 409); }
}
