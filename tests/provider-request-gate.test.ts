import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { ProviderRequestGate, ProviderRequestGateError } from '../src/main/ipc/provider-request-gate'

const directories: string[] = []
const gates: ProviderRequestGate[] = []

afterEach(async () => {
  for (const gate of gates.splice(0)) gate.close()
  for (const directory of directories.splice(0)) await rm(directory, { recursive: true, force: true })
})

function makeGate(...args: ConstructorParameters<typeof ProviderRequestGate>): ProviderRequestGate {
  const gate = new ProviderRequestGate(...args)
  gates.push(gate)
  return gate
}

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void
  const promise = new Promise<void>((done) => { resolve = done })
  return { promise, resolve }
}

describe('provider request gate', () => {
  it('limits concurrent provider requests and releases the slot after failure', async () => {
    const gate = makeGate(10, 1)
    const wait = deferred()
    const first = gate.run(async () => { await wait.promise; throw new Error('provider failed') })

    await expect(gate.run(async () => 'second')).rejects.toMatchObject<Partial<ProviderRequestGateError>>({ reason: 'busy' })
    wait.resolve()
    await expect(first).rejects.toThrow('provider failed')
    await expect(gate.run(async () => 'third')).resolves.toBe('third')
  })

  it('applies a rolling request limit and allows calls again after its window', async () => {
    let time = 0
    const gate = makeGate(2, 2, 60_000, () => time)

    await gate.run(async () => 'first')
    await gate.run(async () => 'second')
    await expect(gate.run(async () => 'third')).rejects.toMatchObject<Partial<ProviderRequestGateError>>({ reason: 'rate_limit' })

    time = 60_001
    await expect(gate.run(async () => 'after window')).resolves.toBe('after window')
  })

  it('keeps long-running requests counted after the rate window expires', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'mike-assist-ai-limit-active-'))
    directories.push(directory)
    const stateFile = path.join(directory, 'ai-request-limits.sqlite')
    let time = 10_000
    const first = makeGate(10, 1, 60_000, () => time, stateFile)
    await first.init()
    const wait = deferred()
    const started = deferred()
    const inFlight = first.run(async () => { started.resolve(); await wait.promise; return 'done' })
    await started.promise

    time += 60_001
    const second = makeGate(10, 1, 60_000, () => time, stateFile)
    await second.init()
    await expect(second.run(async () => 'must stay blocked')).rejects.toMatchObject<Partial<ProviderRequestGateError>>({ reason: 'busy' })

    wait.resolve()
    await expect(inFlight).resolves.toBe('done')
  })

  it('reclaims a request reservation left behind by an app crash', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'mike-assist-ai-limit-expired-'))
    directories.push(directory)
    const stateFile = path.join(directory, 'ai-request-limits.sqlite')
    let time = 10_000
    const first = makeGate(10, 1, 60_000, () => time, stateFile)
    await first.init()
    const wait = deferred()
    const started = deferred()
    const inFlight = first.run(async () => { started.resolve(); await wait.promise; return 'done' })
    await started.promise

    time += 10 * 60_000 + 1
    const afterCrash = makeGate(10, 1, 60_000, () => time, stateFile)
    await afterCrash.init()
    await expect(afterCrash.run(async () => 'recovered')).resolves.toBe('recovered')

    wait.resolve()
    await expect(inFlight).resolves.toBe('done')
  })

  it('keeps recent requests across gate instances and app restarts', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'mike-assist-ai-limit-'))
    directories.push(directory)
    const stateFile = path.join(directory, 'ai-request-limits.sqlite')
    let time = 10_000
    const firstRun = makeGate(2, 2, 60_000, () => time, stateFile)
    await firstRun.init()
    await firstRun.run(async () => 'first request')

    const afterRestart = makeGate(2, 2, 60_000, () => time, stateFile)
    await afterRestart.init()
    await afterRestart.run(async () => 'second request')
    const secondRestart = makeGate(2, 2, 60_000, () => time, stateFile)
    await secondRestart.init()
    await expect(secondRestart.run(async () => 'blocked')).rejects.toMatchObject<Partial<ProviderRequestGateError>>({ reason: 'rate_limit' })

    time += 60_001
    const afterWindow = makeGate(2, 2, 60_000, () => time, stateFile)
    await afterWindow.init()
    await expect(afterWindow.run(async () => 'allowed')).resolves.toBe('allowed')
  })

  it('fails closed when saved usage state is corrupt', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'mike-assist-ai-limit-corrupt-'))
    directories.push(directory)
    const stateFile = path.join(directory, 'ai-request-limits.sqlite')
    await writeFile(stateFile, '{invalid', 'utf8')
    const gate = makeGate(2, 2, 60_000, () => 1_000, stateFile)

    await expect(gate.init()).rejects.toThrow()
    await expect(gate.run(async () => 'should not run')).rejects.toMatchObject<Partial<ProviderRequestGateError>>({ reason: 'storage' })
  })

  it('shares request reservations between independent gate instances', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'mike-assist-ai-limit-shared-'))
    directories.push(directory)
    const stateFile = path.join(directory, 'ai-request-limits.sqlite')
    const first = makeGate(2, 1, 60_000, () => 10_000, stateFile)
    const second = makeGate(2, 1, 60_000, () => 10_000, stateFile)
    await Promise.all([first.init(), second.init()])
    const wait = deferred()
    const inFlight = first.run(async () => { await wait.promise; return 'done' })
    await expect(second.run(async () => 'should not run')).rejects.toMatchObject<Partial<ProviderRequestGateError>>({ reason: 'busy' })
    wait.resolve()
    await expect(inFlight).resolves.toBe('done')
  })
})
