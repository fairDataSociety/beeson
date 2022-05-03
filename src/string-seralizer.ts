const QUOTE_ASCII = 34

export function serializeString(value: string): Uint8Array {
  return new TextEncoder().encode(value + '"')
}

export function deserializeString(value: Uint8Array): string {
  for (let i = value.length - 1; i >= 0; i--) {
    if (value[i] === QUOTE_ASCII) {
      return new TextDecoder().decode(value.slice(0, i))
    }
  }

  throw new Error('The given string byte array is not a valid BeeSon string')
}
