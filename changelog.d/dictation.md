### Added

- Settings > Voice shows the dictation model. You can download it, stop the download, and see its
  status there.

### Changed

- Voice input now uses NVIDIA Parakeet TDT 0.6B v3 in place of Whisper medium. Dictation is in
  English.
- The words show in the message box while you speak, and the full text replaces them when you stop.
- The first voice recording downloads a new model of approximately 670 MB. GoAhead deletes the old
  Whisper model files (approximately 540 MB).
- While you speak, the microphone button changes into a recording bar with a live waveform.
  ✓ puts the text in the message box, × discards the recording, and the send arrow sends it.
- Speech recognition runs in a separate process that stops 60 seconds after the last use.
  Audio stays on this computer.
