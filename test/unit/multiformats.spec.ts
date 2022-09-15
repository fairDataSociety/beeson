import * as Block from 'multiformats/block'
import { BeeSon } from '../../src/beeson'
import * as codec from '../../src/multiformats/codecs'
import { hasher } from '../../src/multiformats/hashes'
import { Type } from '../../src/types'

describe('beeson', () => {
  it('should work with integer type', async () => {
    const json = 123
    const beeson = new BeeSon<number>({ json })
    expect(beeson.typeManager.type).toBe(Type.int32)
    expect(beeson.json).toBe(json)

    const value = beeson
    // encode a block
    const block = await Block.encode({ value, codec, hasher })
    const blockValue = {
      _json: 123,
      _typeManager: {
        _type: 113,
        _typeDefinitions: null,
        _version: '0.1.0',
        nullable: false,
        superBeeSon: false,
      },
    }

    const result = `bah6acgzaseghlmme4zvgvftofrvg7mrcctm3jje3vvmw5h56jf4ncngtj4wq`
    expect(block.value).toEqual(blockValue)
    expect(block.bytes.length).toBe(64)
    expect(block.cid.toString()).toBe(result)

    // decode a block
    const block2 = await Block.decode({
      bytes: block.bytes,
      codec: codec as any,
      hasher,
    })
    expect(await block2.value).toEqual(blockValue)

    // decode a block using create
    const block3 = await Block.create({
      bytes: block.bytes,
      codec: codec as any,
      cid: block.cid,
      hasher,
    })
    expect(await block3.value).toEqual(blockValue)
  })

  it('should work with typed arrays', async () => {
    const json = [0, 1, 2, 3, 5, 6]
    const beeson = new BeeSon({ json })
    expect(beeson.typeManager.type).toBe(Type.array)
    expect(beeson.json).toStrictEqual(json)

    const value = beeson
    // encode a block
    const block = await Block.encode({ value, codec, hasher })

    const result = `bah6acgza5oh7urstecv7kue2j4h7ce3x3esf6ncuopimtuonsqoukekfnyxa`
    // expect(block.value).toEqual(blockValue)
    expect(block.bytes.length).toBe(288)
    expect(block.cid.toString()).toBe(result)

    // decode a block
    const block2 = await Block.decode({
      bytes: block.bytes,
      codec: codec as any,
      hasher,
    })
    let bs = await block2.value
    expect(bs.json).toEqual(json)

    // decode a block using create
    const block3 = await Block.create({
      bytes: block.bytes,
      codec: codec as any,
      cid: block.cid,
      hasher,
    })
    bs = await block3.value
    expect(bs.json).toEqual(json)
  })

  it('should work with 1 level object', async () => {
    let json = { name: 'john coke', age: 48, id: 'ID2' }
    const beeson = new BeeSon({ json })
    expect(beeson.typeManager.type).toStrictEqual(Type.object)
    expect(beeson.json).toStrictEqual(json)

    const value = beeson
    // encode a block
    const block = await Block.encode({ value, codec, hasher })

    const result = `bah6acgzadynfj2sof6jefyxcnvbo36pbahwjkglv2gfb3pptnf44cjwj4cba`
    // expect(block.value).toEqual(blockValue)
    expect(block.bytes.length).toBe(192)
    expect(block.cid.toString()).toBe(result)

    // decode a block
    const block2 = await Block.decode({
      bytes: block.bytes,
      codec: codec as any,
      hasher,
    })
    let bs = await block2.value
    expect(bs.json).toEqual(json)

    // decode a block using create
    const block3 = await Block.create({
      bytes: block.bytes,
      codec: codec as any,
      cid: block.cid,
      hasher,
    })
    bs = await block3.value
    expect(bs.json).toEqual(json)
  })

  it('should work with polymorphic arrays', async () => {
    let json = [0, '1', false, { name: 'john coke' }, 5]
    const beeson = new BeeSon({ json })
    expect(beeson.typeManager.type).toStrictEqual(Type.array)
    expect(beeson.json).toStrictEqual(json)
    const value = beeson
    // encode a block
    const block = await Block.encode({ value, codec, hasher })

    const result = `bah6acgzavrfexn2pvvoqydyzzcd6lw4hzd52slzvkav7i3u7vgxcqfmctxaq`
    // expect(block.value).toEqual(blockValue)
    expect(block.bytes.length).toBe(288)
    expect(block.cid.toString()).toBe(result)

    // decode a block
    const block2 = await Block.decode({
      bytes: block.bytes,
      codec: codec as any,
      hasher,
    })
    let bs = await block2.value
    expect(bs.json).toEqual(json)

    // decode a block using create
    const block3 = await Block.create({
      bytes: block.bytes,
      codec: codec as any,
      cid: block.cid,
      hasher,
    })
    bs = await block3.value
    expect(bs.json).toEqual(json)
  })

  it('should work with complex object', async () => {
    let json = { name: 'john coke', age: 48, id: 'ID2', buddies: [{ name: 'jesus', age: 33, id: 'ID1' }] }
    const beeson = new BeeSon({ json })
    expect(beeson.typeManager.type).toStrictEqual(Type.object)
    expect(beeson.json).toStrictEqual(json)
    const value = beeson
    // encode a block
    const block = await Block.encode({ value, codec, hasher })

    const result = `bah6acgzaqufakm2ximqq7xnebhgg2x2hs6blymcx64uteusf5rdwnwcsdkoa`
    // expect(block.value).toEqual(blockValue)
    expect(block.cid.toString()).toBe(result)

    // decode a block
    const block2 = await Block.decode({
      bytes: block.bytes,
      codec: codec as any,
      hasher,
    })
    let bs = await block2.value
    expect(bs.json).toEqual(json)

    // decode a block using create
    const block3 = await Block.create({
      bytes: block.bytes,
      codec: codec as any,
      cid: block.cid,
      hasher,
    })
    bs = await block3.value
    expect(bs.json).toEqual(json)
  })
})
