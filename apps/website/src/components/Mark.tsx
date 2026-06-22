export function WriterMark({ size = 18 }: { size?: number }) {
  const w = (size * 27) / 19;
  return (
    <svg
      width={w}
      height={size}
      viewBox="0 0 27 19"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
      fill="currentColor"
    >
      <path
        d="M4.92 0V1.64H6.56V14.76H9.84V13.12H11.48V3.28H9.84V4.92H8.2V3.28H9.84V1.64H11.48V0H13.12V1.64H14.76V14.76H18.04V13.12H19.68V3.28H18.04V4.92H16.4V3.28H18.04V1.64H19.68V0H21.32V1.64H22.96V14.76H24.6V13.12H26.24V14.76H24.6V16.4H22.96V18.04H21.32V16.4H19.68V14.76H18.04V16.4H14.76V18.04H13.12V16.4H11.48V14.76H9.84V16.4H6.56V18.04H4.92V16.4H3.28V3.28H1.64V4.92H0V3.28H1.64V1.64H3.28V0H4.92Z"
        transform="translate(0, -2.5)"
      />
    </svg>
  );
}

export function AppleGlyph({ size = 14 }: { size?: number }) {
  const w = (size * 12) / 14;
  return (
    <svg
      width={w}
      height={size}
      viewBox="0 0 24 28"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
      fill="currentColor"
    >
      <path d="M19.05 21.28c-.98.95-2.05.86-3.08.41-1.07-.46-2.09-.48-3.24 0-1.44.62-2.2.44-3.06-.41C4.79 16.25 5.51 8.59 11.05 8.31c1.35.07 2.29.74 3.08.8 1.18-.24 2.31-.93 3.57-.84 1.51.12 2.65.72 3.4 1.8-3.12 1.87-2.38 5.98.48 7.13-.57 1.5-1.31 2.99-2.54 4.09zM14 8.25c-.15-2.23 1.66-4.07 3.74-4.25.29 2.58-2.34 4.5-3.74 4.25z" />
    </svg>
  );
}
