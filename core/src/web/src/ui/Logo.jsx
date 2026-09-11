// The Fount mark, inline so it follows the theme through currentColor.
//
// Two cuts of the same symbol. The display cut keeps the drawn proportions of
// the brand master (see docs/BRAND-GEOMETRY.md). The small cut thickens the
// stem, the fold and the pointer so the mark still reads at 16-32 px, where
// the display cut collapses into a smudge. The switch is by rendered size, so
// callers never pick a variant by hand.

const DISPLAY = {
  letter:
    "M48 32H268C285.673112 32 300 46.326888 300 64V70C288 64 277 62 260 62H252C216 62 196 84 196 120V192C196 228 216 248 252 248H300V284H252C216 284 196 306 196 342V376C196 420 218 440 262 446V452H48V446C88 442 104 420 104 376V112C104 68 88 44 48 38Z",
  fold: "M268 32C285.673112 32 300 46.326888 300 64V118C300 140.091390 317.908610 158 340 158H404C402 144 394 134 384 124L302 42C293 35 281 32 268 32Z",
  cursor:
    "M338 180C338 176 342 174 345 177L430 240C434 243 433 248 428 249L398 256L418 295C420 299 418 303 414 305L402 311C398 313 394 311 392 307L374 270L348 292C344 295 340 293 340 288Z",
};

const SMALL = {
  letter:
    "M36 32H280C298 32 312 46 312 64V80C300 74 288 70 272 70H268C232 70 214 90 214 124V192C214 228 232 246 268 246H312V294H268C232 294 214 312 214 348V370C214 414 236 434 278 440V452H36V440C82 436 98 414 98 370V114C98 70 82 48 36 44Z",
  fold: "M280 32C298 32 312 46 312 64V112C312 140 334 162 362 162H436C434 146 426 134 414 122L322 42C310 34 296 32 280 32Z",
  cursor:
    "M314 186C314 177 323 172 330 178L452 264C459 270 456 280 447 282L404 293L432 350C435 357 433 364 426 367L406 377C399 380 392 378 389 371L362 315L332 345C326 351 314 347 314 339Z",
};

/** Above this rendered size the display cut is the better drawing. */
const SMALL_CUT_MAX = 40;

export function Mark({ size = 28, class: className = "", ...rest }) {
  const cut = size <= SMALL_CUT_MAX ? SMALL : DISPLAY;
  return (
    <svg
      class={`mark ${className}`.trim()}
      viewBox="0 0 480 480"
      width={size}
      height={size}
      aria-hidden="true"
      focusable="false"
      {...rest}
    >
      <path fill="currentColor" d={cut.letter} />
      <path class="mark-fold" d={cut.fold} />
      <path fill="currentColor" d={cut.cursor} />
    </svg>
  );
}
