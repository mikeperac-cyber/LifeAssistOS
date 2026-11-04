'use strict'

const { createRequire } = require('node:module')
const path = require('node:path')

const parentPort = process.parentPort
let started = false

async function runCode(code) {
  let queue = Promise.resolve()
  const invoke = async (name, args) => {
    const response = await fetch(process.env.MIKE_ASSIST_TOOL_RPC_URL, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'authorization': `Bearer ${process.env.MIKE_ASSIST_TOOL_RPC_TOKEN}`
      },
      body: JSON.stringify({ tool: name, args })
    })
    const result = await response.json()
    if (!response.ok) throw new Error(result.error || 'The tool call failed.')
    if (result.denied) throw new Error('The user denied this tool call. The code run is stopping.')
    return result
  }
  const tools = Object.freeze({
    call: (name, args = {}) => {
      const next = queue.then(() => invoke(name, args))
      queue = next.then(() => undefined, () => undefined)
      return next
    }
  })
  Object.defineProperty(globalThis, 'tools', { value: tools, enumerable: false, configurable: false, writable: false })
  const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor
  const codeRequire = createRequire(path.join(process.cwd(), 'mike-assist-execution.cjs'))
  const run = new AsyncFunction('tools', 'require', 'process', 'Buffer', '__dirname', '__filename', code)
  let runError
  try {
    await run(tools, codeRequire, process, Buffer, process.cwd(), '<execute_code>')
  } catch (error) {
    runError = error
  }
  await queue
  if (runError) throw runError
}

function onMessage(event) {
  const message = event && typeof event === 'object' && 'data' in event ? event.data : event
  if (!message || typeof message !== 'object' || message.type !== 'start' || started) return
  started = true
  void runCode(message.code).catch((error) => {
    console.error(error && error.stack ? error.stack : String(error))
    process.exitCode = 1
  }).finally(() => {
    if (!parentPort && process.connected) process.disconnect()
  })
}

if (parentPort) parentPort.on('message', onMessage)
else process.on('message', onMessage)
