export type Success<T> = readonly [error: undefined, data: T]
export type Failure<E> = readonly [error: E, data: undefined]
export type GoResponse<T, E = unknown> = Success<T> | Failure<E>

export function success<T>(value: T): Success<T> {
  return [undefined, value] as const
}

export function failure<E>(error: E): Failure<E> {
  return [error, undefined] as const
}
