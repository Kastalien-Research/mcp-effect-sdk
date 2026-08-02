# Clock

Implement `class Clock` with `constructor(hour: number, minute?: number)`,
`toString(): string`, and `add(minutes: number): Clock`.

The constructor wraps to a valid 24-hour/60-minute time, accepting negative or
out-of-range values (e.g. `new Clock(25, 0)` is `01:00`). `toString` renders
zero-padded `"HH:MM"`. `add` returns a *new* `Clock` shifted by the given
number of minutes (positive or negative), wrapping across midnight.
