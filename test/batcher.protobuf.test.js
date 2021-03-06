const Batcher = require('../src/batcher')
const got = require('got')
const { logproto } = require('../src/proto')
const fixtures = require('./fixtures.json')

const { createProtoTimestamps } = require('../src/proto/helpers')

let batcher

describe('Batcher tests with Protobuf + gRPC transport', function () {
  beforeEach(async function () {
    jest.resetModules()
    batcher = new Batcher(fixtures.options_protobuf)
    got.post = await jest
      .spyOn(got, 'post')
      .mockImplementation(() => Promise.resolve())
  })
  afterEach(function () {
    batcher.clearBatch()
    got.post.mockRestore()
  })
  it('Should add same items in the same stream', function () {
    batcher.pushLogEntry(JSON.parse(fixtures.logs_mapped[0]))
    batcher.pushLogEntry(JSON.parse(fixtures.logs_mapped[0]))
    expect(batcher.batch.streams.length).toBe(1)
  })
  it('Should add items with same labels in the same stream', function () {
    batcher.pushLogEntry(JSON.parse(fixtures.logs_mapped[1]))
    batcher.pushLogEntry(JSON.parse(fixtures.logs_mapped[2]))
    expect(batcher.batch.streams.length).toBe(1)
  })
  it('Should convert the timestamps on push when batching is disabled', async function () {
    const options = JSON.parse(JSON.stringify(fixtures.options_protobuf))
    options.batching = false
    batcher = new Batcher(options)

    const logEntryConverted = createProtoTimestamps(
      JSON.parse(fixtures.logs_mapped[1])
    )
    const stub = await jest.spyOn(batcher, 'sendBatchToLoki')

    batcher.pushLogEntry(JSON.parse(fixtures.logs_mapped[1]))
    expect(stub).toHaveBeenCalledWith(logEntryConverted)
    stub.mockRestore()
  })
  it('Should be able to clear the batch of streams', function () {
    batcher.pushLogEntry(JSON.parse(fixtures.logs_mapped[0]))
    batcher.pushLogEntry(JSON.parse(fixtures.logs_mapped[2]))
    expect(batcher.batch.streams.length).toBe(2)
    batcher.clearBatch()
    expect(batcher.batch.streams.length).toBe(0)
  })
  it('Should fail if the batch is not constructed correctly', async function () {
    batcher.pushLogEntry(fixtures.incorrectly_mapped)
    try {
      await batcher.sendBatchToLoki()
    } catch (error) {
      expect(error).toBeTruthy()
    }
  })
  it("Should fail if snappy can't compress the buffer", async function () {
    batcher.pushLogEntry(JSON.parse(fixtures.logs_mapped[2]))
    this.finish = await jest.spyOn(
      logproto.PushRequest.encode(batcher.batch),
      'finish'
    )
    this.finish.mockReturnValue(null)
    try {
      await batcher.sendBatchToLoki()
    } catch (error) {
      expect(error).toBeTruthy()
    }
  })
  it('Should wrap single logEntry in {streams: []} if batching is disabled', async function () {
    const options = JSON.parse(JSON.stringify(fixtures.options_protobuf))
    options.batching = false
    batcher = new Batcher(options)
    const responseObject = {
      statusCode: 200,
      headers: {
        'content-type': 'application/json'
      }
    }
    got.post.mockResolvedValue(responseObject)
    await batcher.pushLogEntry(JSON.parse(fixtures.logs_mapped[1]))

    const logEntryConverted = createProtoTimestamps(
      JSON.parse(fixtures.logs_mapped[1])
    )
    const buffer = logproto.PushRequest.encode({
      streams: [logEntryConverted]
    }).finish()

    const snappy = require('snappy')
    const data = snappy.compressSync(buffer)
    expect(
      got.post.mock.calls[0][got.post.mock.calls[0].length - 1].body
    ).toEqual(data)
  })
  it('Should construct without snappy binaries to a JSON transport', function () {
    batcher = new Batcher(fixtures.options_protobuf)
    expect(batcher.options.json).toBe(false)
    jest.spyOn(Batcher.prototype, 'loadSnappy').mockImplementation(() => false)
    batcher = new Batcher(fixtures.options_protobuf)
    expect(batcher.options.json).toBe(true)
  })
})
