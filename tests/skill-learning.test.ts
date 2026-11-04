import { describe, expect, it } from 'vitest'
import { buildSkillLearningRequest } from '../src/renderer/src/skill-learning'

describe('skill learning request', () => {
  it('asks the assistant to generalize a successful workflow and gate saving on approval', () => {
    const request = buildSkillLearningRequest([
      { tool: 'read_file' },
      { tool: 'write_file' },
      { tool: 'read_file' }
    ])

    expect(request).toContain('read_file, write_file')
    expect(request).toContain('Generalize one-off paths')
    expect(request).toContain('Never include credentials, tokens, or secrets')
    expect(request).toContain('inspect the complete skill in the approval preview')
    expect(request).toContain('save it only after I approve')
    expect(request).not.toContain('write_file, read_file')
  })
})
