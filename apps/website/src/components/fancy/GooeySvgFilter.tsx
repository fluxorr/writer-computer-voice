interface GooeySvgFilterProps {
  id: string;
  strength?: number;
}

export default function GooeySvgFilter({ id, strength = 5 }: GooeySvgFilterProps) {
  return (
    <svg className="absolute w-0 h-0" aria-hidden="true">
      <defs>
        <filter id={id}>
          <feGaussianBlur in="SourceGraphic" stdDeviation={strength} result="blur" />
          <feColorMatrix
            in="blur"
            type="matrix"
            values={`1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 ${18 - strength} -${(18 - strength) * 1.5}`}
            result="goo"
          />
          <feComposite in="SourceGraphic" in2="goo" operator="atop" />
        </filter>
      </defs>
    </svg>
  );
}
