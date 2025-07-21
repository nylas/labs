import { failure, success } from "../types.js"

// A handler that takes a promise and returns GoResponse
export async function handlePromise<T>(promise: Promise<T>) {
  try {
    const data = await promise
    return success(data)
  } catch (error) {
    if (error instanceof Error) {
      return failure(error)
    }
    return failure(new Error(String(error)))
  }
}
