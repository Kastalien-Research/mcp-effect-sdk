# Run-Length Encoding

Implement `encode(s: string): string` and `decode(s: string): string`.

`encode` replaces runs of 2 or more identical consecutive characters with the
run length followed by the character, e.g. `"aabbbcccc"` → `"2a3b4c"`. A run
of length 1 is left as the bare character (no `"1"` prefix). `decode` reverses
this exactly. Input is restricted to letters and whitespace — never digits —
so counts are unambiguous.
