import { BitVector } from '../../src/bitvector'

describe('bitvector', () => {
  it('should work set/get/clear methods', () => {
    const bv = new BitVector(8)
    const setGet = (bitIndex: number) => {
      expect(bv.getBit(bitIndex)).toBe(false)
      bv.setBit(bitIndex)
      expect(bv.getBit(bitIndex)).toBe(true)
    }
    const clear = (bitIndex: number) => {
      bv.clearBit(bitIndex)
      expect(bv.getBit(bitIndex)).toBe(false)
    }
    setGet(1)
    expect(Number(bv.bitVector)).toBe(2)
    setGet(0)
    expect(Number(bv.bitVector)).toBe(3)
    clear(1)
    expect(Number(bv.bitVector)).toBe(1)
    clear(0)
    expect(Number(bv.bitVector)).toBe(0)
  })

  it('should work with bigger bitcounts', () => {
    const bv = new BitVector(258)
    expect(bv.bitVector.length).toBe(33)
    expect(bv.getBit(257)).toBe(false)
    bv.setBit(257)
    expect(bv.getBit(257)).toBe(true)
    bv.clearBit(257)
    expect(bv.getBit(257)).toBe(false)
    expect(() => bv.setBit(2590)).toThrowError(/^Bit vector can contain maximum /)
    expect(() => bv.setBit(258)).toThrowError(/^Bit vector can contain maximum /)
    expect(() => bv.setBit(-1)).toThrowError('BitIndex cannot be lower than 0')
  })
})
