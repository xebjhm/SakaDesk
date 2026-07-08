import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { TranscriptPanel } from './TranscriptPanel'

describe('TranscriptPanel no-speech state', () => {
  it('shows a "no audible speech" note and hides the segment list', () => {
    render(<TranscriptPanel segments={[]} noSpeech />)

    expect(screen.getByText(/no audible speech/i)).toBeInTheDocument()
    // The jump hint belongs to the segment list, which must not render here.
    expect(screen.queryByText(/click to jump/i)).not.toBeInTheDocument()
  })

  it('does not show the no-speech note for a normal transcript', () => {
    render(
      <TranscriptPanel
        segments={[{ start: 0, end: 1, text: 'やあ', confidence: 1 }]}
      />
    )

    expect(screen.queryByText(/no audible speech/i)).not.toBeInTheDocument()
  })
})
