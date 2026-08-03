# Luhn

Implement `valid(digits: string): boolean` — the Luhn checksum. Strings of
length ≤ 1, or containing non-digit non-space characters, are invalid. Spaces
are allowed and ignored. Double every second digit from the right; subtract 9
when a doubled digit exceeds 9; valid iff the sum % 10 === 0.
