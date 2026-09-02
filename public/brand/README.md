# Brand assets

Save the logo here as `logo.png` (jpg, bmp and gif also work), then run:

```bash
npm run brand:sample
```

That reads the outermost ring of pixels, takes the median so a bright corner
cannot skew it, and writes the result into `src/index.css` as `--brand-canvas`
— the colour the sign-in and sign-up pages are painted. It also picks the ink
colour for that ground by luminance.

The measuring matters. The logo's outer edge is masked to transparent so it
dissolves into the page, and that only reads as one surface if the two colours
are the same. A near miss shows as a halo, which is worse than no feather at
all — and a hex guessed by eye off a gradient is exactly the kind of near miss
that does it.

If the logo has a transparent background the script will say so and stop: there
is no edge colour to match, and it needs no canvas.
