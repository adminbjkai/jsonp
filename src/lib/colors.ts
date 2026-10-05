const HEX = /^#(?:[\da-f]{3,4}|[\da-f]{6}|[\da-f]{8})$/i;
const FUNCTIONAL = /^(?:rgba?|hsla?)\(\s*-?[\d.]+(?:deg|%)?(?:\s*[,\s/]\s*-?[\d.]+%?){2,3}\s*\)$/i;

/** True for CSS colors worth previewing: hex, rgb(a), and hsl(a) values. */
export const isColorValue = (value: string) => HEX.test(value) || FUNCTIONAL.test(value);
