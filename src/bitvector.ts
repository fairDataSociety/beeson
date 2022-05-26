export class BitVector {
  public bitVector: Uint8Array
  constructor(private bitCount: number) {
    this.bitVector = new Uint8Array(Math.ceil(bitCount / 8))
  }

  /** Clear the i-th bit */
  public clearBit(i: number) {
    const { bigIndex, smallIndex } = this.getVectorIndices(i)

    this.bitVector[bigIndex] &= ~(1 << smallIndex)
  }

  /** Return the value of the i-th bit */
  public getBit(i: number): boolean {
    const { bigIndex, smallIndex } = this.getVectorIndices(i)
    const value = this.bitVector[bigIndex] & (1 << smallIndex)

    // we convert to boolean to make sure the result is always 0 or 1,
    // instead of what is returned by the mask
    return value !== 0
  }

  /** Set the i-th bit to 1 */
  public setBit(i: number) {
    const { bigIndex, smallIndex } = this.getVectorIndices(i)

    this.bitVector[bigIndex] |= 1 << smallIndex
  }

  /** Returns bitvector in Uint8Array */
  public getBytes(): Uint8Array {
    return Uint8Array.from(this.bitVector)
  }

  private getVectorIndices(i: number): { bigIndex: number; smallIndex: number } {
    if (i < 0) {
      throw new Error(`BitIndex cannot be lower than 0`)
    }
    if (i >= this.bitCount) {
      throw new Error(
        `Bit vector can contain maximum ${this.bitCount} bits and the given bitIndex is higher ${i}`,
      )
    }
    const bigIndex = i >> 3 // Math.floor(i / 8)
    const smallIndex = i % 8

    return { bigIndex, smallIndex }
  }
}
