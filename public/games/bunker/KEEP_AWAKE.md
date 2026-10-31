# Keeping the bunker screen awake

`keep-awake.js` requests the standard Screen Wake Lock API while the page is visible, reacquires after returning to the page, and releases on background/exit. Revocation uses a bounded retry. Pending requests are released if they complete after navigation. Sleep inhibition runs independently of the music toggle.

Browsers without the API, or refusing a lock, try an inline muted looping H.264 video. Real clicks and remote key presses retry acquisition/playback when user activation is required. This is best-effort compatibility, not simulated mouse activity. TV operating-system screensavers and energy-saving policies can override either technique. Verify on the actual built-in TV browser; browser simulation cannot prove that the TV's screensaver is inhibited.

The 10-second, 32x32, 2 fps silent `assets/keep-awake.mp4` was generated locally from a solid color using FFmpeg (`color`, libx264 baseline, yuv420p, faststart). It contains no third-party media or audio. No external runtime dependency is required.

References:
- https://developer.mozilla.org/en-US/docs/Web/API/Screen_Wake_Lock_API
- https://github.com/richtr/NoSleep.js/blob/master/src/index.js (video fallback precedent; no source or media copied)
