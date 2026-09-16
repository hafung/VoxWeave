import type { HyperframesPlayer } from '@hyperframes/player';
import type { DetailedHTMLProps, HTMLAttributes } from 'react';

declare module 'react' {
  namespace JSX {
    interface IntrinsicElements {
      'hyperframes-player': DetailedHTMLProps<HTMLAttributes<HyperframesPlayer>, HyperframesPlayer> & {
        src?: string;
        controls?: boolean;
        width?: number;
        height?: number;
        'audio-src'?: string;
        'sandbox-origin'?: string;
      };
    }
  }
}
