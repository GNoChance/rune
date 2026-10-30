// fichier généré par svg-to-tsx.mjs : ne pas modifier à la main, relancer le script.
// Pierre runique du rang E (galet griffé), d'après docs/brand/rangs/rank-E.svg ; version mini (24–32 px)
// d'après docs/brand/rangs/mini/. Dans le bundle initial ; les rangs D à S sont dans RankStoneUpper.tsx.
import type { ArtSvgProps, RankStoneProps } from './art-types';

/** docs/brand/rangs/rank-E.svg */
function rankE(p: string, svg: ArtSvgProps) {
  return (
    // biome-ignore lint/a11y/noSvgWithoutTitle: nom accessible posé par l'appelant (role, aria-label)
    <svg viewBox="0 0 512 512" data-variant="E" {...svg}>
      <defs>
        <clipPath id={`${p}-pierre-e-vc`}>
          <path d="M92 322C89 297 94 268 104 246C114 224 129.3 204.3 152 190C174.7 175.7 209.7 165 240 160C270.3 155 334 160 334 160C334 160 392 186 392 186C392 186 424 231.7 430 258C436 284.3 435.3 319 428 344C420.7 369 407 392 386 408C365 424 333.7 435 302 440C270.3 445 226 445.3 196 438C166 430.7 139.3 415.3 122 396C104.7 376.7 95 347 92 322Z" />
        </clipPath>
        <clipPath id={`${p}-pierre-e-vc2`}>
          <path
            d="M92 322C89 297 94 268 104 246C114 224 129.3 204.3 152 190C174.7 175.7 209.7 165 240 160C270.3 155 334 160 334 160C334 160 392 186 392 186C392 186 424 231.7 430 258C436 284.3 435.3 319 428 344C420.7 369 407 392 386 408C365 424 333.7 435 302 440C270.3 445 226 445.3 196 438C166 430.7 139.3 415.3 122 396C104.7 376.7 95 347 92 322Z"
            transform="translate(-12 -11)"
          />
        </clipPath>
        <linearGradient
          id={`${p}-pierre-e-body`}
          gradientUnits="userSpaceOnUse"
          x1="91.1"
          y1="157.8"
          x2="434"
          y2="443.6"
        >
          <stop offset="0" stopColor="#C3BDB3" />
          <stop offset="1" stopColor="#8F887E" />
        </linearGradient>
        <mask id={`${p}-pierre-e-lmask`} maskUnits="userSpaceOnUse" x="0" y="0" width="512" height="512">
          <path
            d="M307 240H232V360H307M232 297.8H293.5"
            fill="none"
            stroke="#fff"
            strokeWidth="30"
            strokeLinejoin="miter"
            strokeMiterlimit="8"
            strokeLinecap="butt"
          />
        </mask>
      </defs>
      <g id={`${p}-pierre-e-frame`}>
        <g clipPath={`url(#${p}-pierre-e-vc)`}>
          <path
            d="M92 322C89 297 94 268 104 246C114 224 129.3 204.3 152 190C174.7 175.7 209.7 165 240 160C270.3 155 334 160 334 160C334 160 392 186 392 186C392 186 424 231.7 430 258C436 284.3 435.3 319 428 344C420.7 369 407 392 386 408C365 424 333.7 435 302 440C270.3 445 226 445.3 196 438C166 430.7 139.3 415.3 122 396C104.7 376.7 95 347 92 322Z"
            fill="#756E64"
          />
          <g clipPath={`url(#${p}-pierre-e-vc2)`}>
            <path
              d="M92 322C89 297 94 268 104 246C114 224 129.3 204.3 152 190C174.7 175.7 209.7 165 240 160C270.3 155 334 160 334 160C334 160 392 186 392 186C392 186 424 231.7 430 258C436 284.3 435.3 319 428 344C420.7 369 407 392 386 408C365 424 333.7 435 302 440C270.3 445 226 445.3 196 438C166 430.7 139.3 415.3 122 396C104.7 376.7 95 347 92 322Z"
              fill="#DDD8CF"
            />
            <path
              d="M92 322C89 297 94 268 104 246C114 224 129.3 204.3 152 190C174.7 175.7 209.7 165 240 160C270.3 155 334 160 334 160C334 160 392 186 392 186C392 186 424 231.7 430 258C436 284.3 435.3 319 428 344C420.7 369 407 392 386 408C365 424 333.7 435 302 440C270.3 445 226 445.3 196 438C166 430.7 139.3 415.3 122 396C104.7 376.7 95 347 92 322Z"
              transform="translate(5 5)"
              fill={`url(#${p}-pierre-e-body)`}
            />
          </g>
        </g>
        <circle cx="266.6" cy="309.3" r="2.5" fill="#E9E4DB" opacity="0.5" />
        <circle cx="382.9" cy="311.6" r="2.4" fill="#6D665C" opacity="0.45" />
        <circle cx="299.5" cy="286.5" r="3.1" fill="#E9E4DB" opacity="0.5" />
        <circle cx="235.1" cy="349.4" r="1.6" fill="#9C9488" opacity="0.6" />
        <circle cx="152.4" cy="236.7" r="2" fill="#E9E4DB" opacity="0.5" />
        <circle cx="290.9" cy="194.2" r="2.5" fill="#E9E4DB" opacity="0.5" />
        <circle cx="234.6" cy="399.1" r="2.9" fill="#9C9488" opacity="0.6" />
        <circle cx="200" cy="335.9" r="1.3" fill="#6D665C" opacity="0.45" />
        <circle cx="192.9" cy="199.7" r="2" fill="#9C9488" opacity="0.6" />
        <circle cx="280.9" cy="322.6" r="1.5" fill="#9C9488" opacity="0.6" />
        <circle cx="261.7" cy="308.2" r="2.3" fill="#6D665C" opacity="0.45" />
        <circle cx="243.6" cy="339.2" r="2.1" fill="#9C9488" opacity="0.6" />
        <circle cx="251" cy="258.7" r="2.8" fill="#6D665C" opacity="0.45" />
        <circle cx="235" cy="374.9" r="2.4" fill="#6D665C" opacity="0.45" />
        <circle cx="210.4" cy="398.6" r="1.5" fill="#6D665C" opacity="0.45" />
        <circle cx="307.2" cy="336.1" r="2" fill="#6D665C" opacity="0.45" />
        <circle cx="220.6" cy="425.7" r="2.6" fill="#9C9488" opacity="0.6" />
        <circle cx="232" cy="420.4" r="2.2" fill="#E9E4DB" opacity="0.5" />
        <circle cx="196.7" cy="304.9" r="3.1" fill="#6D665C" opacity="0.45" />
        <circle cx="194.6" cy="274.5" r="1.4" fill="#6D665C" opacity="0.45" />
        <circle cx="346.6" cy="313.4" r="1.4" fill="#E9E4DB" opacity="0.5" />
        <circle cx="283.1" cy="335.6" r="3.3" fill="#9C9488" opacity="0.6" />
        <circle cx="296.3" cy="330.4" r="2.3" fill="#E9E4DB" opacity="0.5" />
        <circle cx="123.5" cy="344.1" r="3.4" fill="#E9E4DB" opacity="0.5" />
        <circle cx="334.8" cy="196.4" r="2.6" fill="#6D665C" opacity="0.45" />
        <circle cx="408.5" cy="265.4" r="2.6" fill="#9C9488" opacity="0.6" />
        <circle cx="318.8" cy="298.5" r="1.7" fill="#E9E4DB" opacity="0.5" />
        <circle cx="337.4" cy="247.8" r="2.4" fill="#6D665C" opacity="0.45" />
        <circle cx="221.8" cy="209.5" r="3.3" fill="#9C9488" opacity="0.6" />
        <circle cx="239.6" cy="400.9" r="2.7" fill="#E9E4DB" opacity="0.5" />
        <circle cx="261.2" cy="298.2" r="3" fill="#6D665C" opacity="0.45" />
        <circle cx="332.5" cy="396.4" r="3.4" fill="#9C9488" opacity="0.6" />
        <circle cx="295.5" cy="270.7" r="2.4" fill="#E9E4DB" opacity="0.5" />
        <circle cx="249.8" cy="235.1" r="2.8" fill="#E9E4DB" opacity="0.5" />
        <circle cx="233" cy="254.4" r="2" fill="#E9E4DB" opacity="0.5" />
        <circle cx="243.9" cy="227.9" r="1.9" fill="#9C9488" opacity="0.6" />
        <circle cx="284" cy="341.7" r="1.5" fill="#6D665C" opacity="0.45" />
        <circle cx="147.6" cy="392.8" r="3" fill="#6D665C" opacity="0.45" />
        <circle cx="157.4" cy="338.5" r="2.8" fill="#9C9488" opacity="0.6" />
        <circle cx="208.7" cy="185.5" r="2.6" fill="#9C9488" opacity="0.6" />
        <circle cx="338.3" cy="323" r="2.8" fill="#9C9488" opacity="0.6" />
        <circle cx="222.7" cy="376.2" r="1.6" fill="#6D665C" opacity="0.45" />
        <circle cx="138.7" cy="336.5" r="2.4" fill="#6D665C" opacity="0.45" />
        <circle cx="269.4" cy="408.2" r="2.4" fill="#6D665C" opacity="0.45" />
        <circle cx="354.6" cy="230" r="1.5" fill="#9C9488" opacity="0.6" />
        <circle cx="391.2" cy="292.8" r="3.4" fill="#9C9488" opacity="0.6" />
        <circle cx="224.5" cy="290" r="1.4" fill="#E9E4DB" opacity="0.5" />
        <circle cx="279.8" cy="321.1" r="3.3" fill="#6D665C" opacity="0.45" />
        <circle cx="242.6" cy="266.8" r="2" fill="#6D665C" opacity="0.45" />
        <circle cx="289.7" cy="289.5" r="2" fill="#9C9488" opacity="0.6" />
        <circle cx="286.3" cy="313.2" r="2.3" fill="#6D665C" opacity="0.45" />
        <circle cx="253.9" cy="274.1" r="1.7" fill="#6D665C" opacity="0.45" />
        <circle cx="239.3" cy="381.6" r="2.5" fill="#E9E4DB" opacity="0.5" />
        <circle cx="322.7" cy="265.8" r="3.2" fill="#9C9488" opacity="0.6" />
        <circle cx="204" cy="360.9" r="1.5" fill="#6D665C" opacity="0.45" />
        <circle cx="270.4" cy="352.8" r="3.2" fill="#6D665C" opacity="0.45" />
        <circle cx="398.7" cy="267.4" r="2.5" fill="#9C9488" opacity="0.6" />
        <circle cx="243.3" cy="222" r="2.8" fill="#6D665C" opacity="0.45" />
        <circle cx="337.3" cy="192.8" r="2.9" fill="#E9E4DB" opacity="0.5" />
        <circle cx="345.2" cy="192.8" r="1.6" fill="#6D665C" opacity="0.45" />
        <circle cx="177.5" cy="343.6" r="1.9" fill="#6D665C" opacity="0.45" />
        <circle cx="336.6" cy="373.6" r="3.3" fill="#E9E4DB" opacity="0.5" />
        <circle cx="280.5" cy="388.8" r="2.1" fill="#E9E4DB" opacity="0.5" />
        <circle cx="189.7" cy="415.1" r="2.4" fill="#6D665C" opacity="0.45" />
        <circle cx="242.3" cy="349.8" r="1.6" fill="#E9E4DB" opacity="0.5" />
        <circle cx="320.9" cy="237.8" r="1.4" fill="#6D665C" opacity="0.45" />
        <circle cx="395.3" cy="272" r="2.5" fill="#6D665C" opacity="0.45" />
        <circle cx="244.9" cy="215" r="1.3" fill="#6D665C" opacity="0.45" />
        <circle cx="225.3" cy="418.8" r="3.2" fill="#E9E4DB" opacity="0.5" />
        <circle cx="209" cy="256.8" r="1.2" fill="#E9E4DB" opacity="0.5" />
        <path
          d="M92 322C89 297 94 268 104 246C114 224 129.3 204.3 152 190C174.7 175.7 209.7 165 240 160C270.3 155 334 160 334 160C334 160 392 186 392 186C392 186 424 231.7 430 258C436 284.3 435.3 319 428 344C420.7 369 407 392 386 408C365 424 333.7 435 302 440C270.3 445 226 445.3 196 438C166 430.7 139.3 415.3 122 396C104.7 376.7 95 347 92 322Z"
          fill="none"
          stroke="#47423B"
          strokeWidth="7"
          strokeLinejoin="round"
        />
      </g>
      <g id={`${p}-pierre-e-ornament`}>
        <path d="M307 239L324 236" stroke="#3A352F" strokeWidth="3.2" strokeLinecap="round" opacity="0.8" />
        <path d="M219 375L214 392" stroke="#3A352F" strokeWidth="3.2" strokeLinecap="round" opacity="0.8" />
        <path d="M307 361L322 363" stroke="#3A352F" strokeWidth="2.6" strokeLinecap="round" opacity="0.7" />
        <path d="M146 330L170 318" stroke="#3A352F" strokeWidth="2.4" strokeLinecap="round" opacity="0.5" />
        <path d="M152 342L166 336" stroke="#3A352F" strokeWidth="2" strokeLinecap="round" opacity="0.45" />
        <path d="M360 252L384 278" stroke="#3A352F" strokeWidth="2.4" strokeLinecap="round" opacity="0.5" />
      </g>
      <g id={`${p}-pierre-e-letter`}>
        <path
          d="M307 240H232V360H307M232 297.8H293.5"
          fill="none"
          stroke="#E6E1D8"
          strokeWidth="30"
          strokeLinejoin="miter"
          strokeMiterlimit="8"
          strokeLinecap="butt"
        />
        <g mask={`url(#${p}-pierre-e-lmask)`}>
          <path
            d="M307 240H232V360H307M232 297.8H293.5"
            fill="none"
            stroke="#3A352F"
            strokeWidth="30"
            strokeLinejoin="miter"
            strokeMiterlimit="8"
            strokeLinecap="butt"
            transform="translate(-4 -4)"
          />
        </g>
      </g>
    </svg>
  );
}

/** docs/brand/rangs/mini/rank-E.svg */
function miniE(p: string, svg: ArtSvgProps) {
  return (
    // biome-ignore lint/a11y/noSvgWithoutTitle: nom accessible posé par l'appelant (role, aria-label)
    <svg viewBox="0 0 512 512" data-variant="E-mini" {...svg}>
      <defs>
        <linearGradient
          id={`${p}-pierre-e-body`}
          gradientUnits="userSpaceOnUse"
          x1="18.8"
          y1="57.4"
          x2="497.6"
          y2="456.6"
        >
          <stop offset="0" stopColor="#C3BDB3" />
          <stop offset="1" stopColor="#8F887E" />
        </linearGradient>
      </defs>
      <g id={`${p}-pierre-e-frame`}>
        <path
          d="M20 286.7C15.8 251.8 22.8 211.3 36.8 180.6C50.7 149.9 72.1 122.4 103.8 102.4C135.4 82.4 184.3 67.5 226.7 60.5C269 53.5 357.9 60.5 357.9 60.5C357.9 60.5 438.9 96.8 438.9 96.8C438.9 96.8 483.6 160.6 492 197.3C500.4 234.1 499.4 282.5 489.2 317.4C479 352.4 459.9 384.5 430.6 406.8C401.2 429.2 357.5 444.5 313.3 451.5C269 458.5 207.1 459 165.2 448.7C123.3 438.5 86.1 417.1 61.9 390.1C37.7 363.1 24.2 321.6 20 286.7Z"
          fill={`url(#${p}-pierre-e-body)`}
          stroke="#47423B"
          strokeWidth="20"
          strokeLinejoin="round"
        />
      </g>
      <g id={`${p}-pierre-e-letter`}>
        <path
          d="M332.8 173H220.2V351H332.8M220.2 258.5H311.6"
          fill="none"
          stroke="#2F2B26"
          strokeWidth="58"
          strokeLinejoin="miter"
          strokeMiterlimit="8"
          strokeLinecap="butt"
        />
      </g>
    </svg>
  );
}

/** Pierre du rang E, en grand ou en mini ; ids préfixés par idPrefix. */
export function RankStoneE({ mini = false, idPrefix, ...svg }: Omit<RankStoneProps, 'rank'>) {
  return (mini ? miniE : rankE)(idPrefix, svg);
}
