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
