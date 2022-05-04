import { BeeSon, Type } from '../../src'
import { encodeFeedReference, encodeManifestReference } from '@ethersphere/swarm-cid'
import { SwarmFeedCid, SwarmManifestCid } from '../../src/address-serializer'

describe('beeson', () => {
  it('should work with integer type', () => {
    const json = 123
    const beeson = new BeeSon<number>({ json })
    expect(beeson.abiManager.type).toBe(Type.int32)
    expect(beeson.json).toBe(json)
    expect(beeson.json).toBe(json)
    beeson.json = 345
    beeson.json = beeson.json * -1
    expect(beeson.json).toBe(-345)
    expect(() => (beeson.json = 'john coke' as unknown as number)).toThrowError()
    expect(() => (beeson.json = 12.45)).toThrowError()
  })

  it('should work with floating type', () => {
    const json = 123.123
    const beeson = new BeeSon<number>({ json })
    expect(beeson.abiManager.type).toBe(Type.float64)
    expect(beeson.json).toBe(json)
    // test whether it accepts integer
    beeson.json = 456
    expect(() => (beeson.json = 'john coke' as unknown as number)).toThrowError()
  })

  it('should work with string type', () => {
    const json = 'john coke'
    const beeson = new BeeSon<string>({ json })
    expect(beeson.json).toBe(json)
    expect(beeson.abiManager.type).toBe(Type.string)
    expect(() => (beeson.json = 42 as unknown as string)).toThrowError()
  })

  it('should work with boolean type', () => {
    const json = false
    const beeson = new BeeSon<boolean>({ json })
    expect(beeson.abiManager.type).toBe(Type.boolean)
    expect(beeson.json).toBe(json)
    beeson.json = true
    expect(() => (beeson.json = 0 as unknown as boolean)).toThrowError()
    expect(() => (beeson.json = 'john coke' as unknown as boolean)).toThrowError()
    expect(() => (beeson.json = null as unknown as boolean)).toThrowError()
  })

  it('should work with BigInt type', () => {
    const json = 1n
    const beeson = new BeeSon<BigInt>({ json })
    expect(beeson.abiManager.type).toBe(Type.int64)
    expect(beeson.json).toBe(json)
    beeson.json = -2n
    expect(() => (beeson.json = 0 as unknown as BigInt)).toThrowError()
    expect(() => (beeson.json = 'john coke' as unknown as BigInt)).toThrowError()
    expect(() => (beeson.json = null as unknown as BigInt)).toThrowError()
  })

  it('should work with manifest CID', () => {
    const json = 'bah5acgzadxcwdayt52nxhygvpou6e63p2vsl23m4kc63f2hyk2avg4joafoq'
    const beeson = new BeeSon<SwarmManifestCid>({ json })
    expect(beeson.abiManager.type).toBe(Type.swarmCac)
    expect(beeson.json).toBe(json)
    // test whether it works with CID object as well
    beeson.json = encodeManifestReference('1dc5618313ee9b73e0d57ba9e27b6fd564bd6d9c50bdb2e8f8568153712e015d')
    expect(
      () => (beeson.json = 'bah5qcgzaymd4255atbv6kkelx75ezqaq64n7vhxgbkw64bjfjedougktli6q'),
    ).toThrowError()
    expect(() => (beeson.json = 'john coke')).toThrowError()
  })

  it('should work with feed CID', () => {
    const json = 'bah5qcgzaymd4255atbv6kkelx75ezqaq64n7vhxgbkw64bjfjedougktli6q'
    const beeson = new BeeSon<SwarmFeedCid>({ json })
    expect(beeson.abiManager.type).toBe(Type.swarmSoc)
    expect(beeson.json).toBe(json)
    // test whether it works with CID object as well
    beeson.json = encodeFeedReference('1dc5618313ee9b73e0d57ba9e27b6fd564bd6d9c50bdb2e8f8568153712e015d')
    expect(
      () => (beeson.json = 'bah5acgzadxcwdayt52nxhygvpou6e63p2vsl23m4kc63f2hyk2avg4joafoq'),
    ).toThrowError()
    expect(() => (beeson.json = 'john coke')).toThrowError()
  })

  it('should work with typed arrays', () => {
    const json = [0, 1, 2, 3, 5, 6]
    const beeson = new BeeSon({ json })
    expect(beeson.abiManager.type).toBe(Type.array)
    expect(beeson.json).toStrictEqual(json)
    beeson.json = [3, 4, 5, 0, 0, 0]
    expect(() => (beeson.json = { name: 'john coke' } as unknown as number[])).toThrowError(
      /^Wrong value for type array. Got value has type: object./,
    )
    expect(() => (beeson.json = 'john coke' as unknown as number[])).toThrowError(
      /^Wrong value for type array. Got value has type: string. Value: john coke/,
    )
    expect(() => (beeson.json = [0, 1, 2])).toThrowError(
      /^Given JSON array has 3 length, when the abi defines 6 length/,
    )
    expect(() => (beeson.json = [3, 4, 5, 'john', 'coke', 0] as unknown as number[])).toThrowError(
      /^BeeSon Array assertion problem at index 3: Value is not an integer. Got: john/,
    )
  })

  it('should work with polimorfic arrays', () => {
    let json = [0, '1', false, { name: 'john coke' }, 5]
    const beeson = new BeeSon({ json })
    expect(beeson.abiManager.type).toStrictEqual(Type.array)
    expect(beeson.json).toStrictEqual(json)
    json = [1, '0', true, { name: 'gipsz jakab' }, -6]
    beeson.json = json
    expect(beeson.json).toStrictEqual(json)
    expect(() => (beeson.json = { name: 'john coke' } as unknown as number[])).toThrowError(
      /^Wrong value for type array. Got value has type: object./,
    )
    expect(() => (beeson.json = 'john coke' as unknown as number[])).toThrowError(
      /^Wrong value for type array. Got value has type: string. Value: john coke/,
    )
    expect(() => (beeson.json = [0, 1, 2])).toThrowError(
      /^Given JSON array has 3 length, when the abi defines 5 length/,
    )
    expect(() => (beeson.json = [0, 1, 2])).toThrowError(
      /^Given JSON array has 3 length, when the abi defines 5 length/,
    )
  })

  it('should work with object', () => {
    let json = { name: 'john coke', age: 48, id: 'ID2', buddies: [{ name: 'jesus', age: 33, id: 'ID1' }] }
    const beeson = new BeeSon({ json })
    expect(beeson.abiManager.type).toStrictEqual(Type.object)
    expect(beeson.json).toStrictEqual(json)
    json = { name: 'john coke', age: 49, id: 'ID2', buddies: [{ name: 'buddha', age: 0, id: 'ID-NOPE' }] }
    beeson.json = json
    expect(beeson.json).toStrictEqual(json)
    expect(
      () =>
        (beeson.json = {
          name: 123 as unknown as string,
          age: 50,
          id: 'ID3',
          buddies: [{ name: 'buddha', age: 0, id: 'ID-NOPE' }],
        }),
    ).toThrowError(
      /BeeSon Object assertion problem at index name: Wrong value for type string. Got value has type: number. Value: 123/,
    )
    expect(
      () =>
        (beeson.json = {
          name: 'john coke',
          age: 50,
          id: 'ID3',
          buddies: [],
        }),
    ).toThrowError(
      'BeeSon Object assertion problem at index buddies: Given JSON array has 0 length, when the abi defines 1 length',
    )
  })
})