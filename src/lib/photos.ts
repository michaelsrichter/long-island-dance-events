/** Curated open-licensed sample photos used in page sections. */
import type { ImageMetadata } from 'astro';
import couple from '../assets/uploads/lindy-couple-hand-in-hand.jpg';
import purpleGreen from '../assets/uploads/lindy-dancers-purple-and-green.jpg';
import polkaDots from '../assets/uploads/lindy-dancer-red-hat-polka-dots.jpg';
import tealTop from '../assets/uploads/lindy-dancer-teal-top-at-the-dance-hop.jpg';
import danceFun from '../assets/uploads/lindy-couple-dance-fun.jpg';
import soloJazz from '../assets/uploads/solo-jazz-dancer-hop-and-a-skip.jpg';
import blackDress from '../assets/uploads/lindy-dancer-black-dress.jpg';
import blackYellow from '../assets/uploads/lindy-couple-black-and-yellow.jpg';
import sameSex from '../assets/uploads/lindy-same-sex-couple.jpg';
import greenJumpsuit from '../assets/uploads/lindy-dancer-green-jumpsuit-skip-hop.jpg';

export interface Photo {
  src: ImageMetadata;
  alt: string;
  sample: boolean;
  focus?: string;
  credit?: { author: string; license: string; licenseUrl?: string; sourceUrl: string };
}

const quine = (sourceUrl: string) => ({ author: 'Thomas Quine', license: 'CC BY 2.0', licenseUrl: 'https://creativecommons.org/licenses/by/2.0/', sourceUrl });

export const photos = {
  heroCouple: { src: couple, alt: 'A smiling couple in vintage-style clothes swing dancing hand in hand.', sample: true, focus: '55% 30%', credit: quine('https://commons.wikimedia.org/wiki/File:Hand-in-hand_Lindy_Hop_dancers.jpg') },
  dressedUp: { src: purpleGreen, alt: 'Two Lindy Hop dancers in a green dress and a purple shirt dancing together.', sample: true, focus: '50% 33%', credit: quine('https://commons.wikimedia.org/wiki/File:Lindy_Hop_dancers_in_purple_and_green.jpg') },
  polkaDots: { src: polkaDots, alt: 'A dancer in a red polka-dot skirt swing dancing with a partner in a red hat.', sample: true, focus: '50% 38%', credit: quine('https://commons.wikimedia.org/wiki/File:Lindy_Hop_dancer_with_red_hat_and_red_belt.jpg') },
  danceFloor: { src: danceFun, alt: 'A couple laughing as they swing out together in front of a crowd.', sample: true, focus: '50% 32%', credit: quine('https://commons.wikimedia.org/wiki/File:Dance_fun.jpg') },
  bandNight: { src: tealTop, alt: 'A smiling dancer in a teal top and navy skirt swing dancing at a busy dance.', sample: true, focus: '45% 30%', credit: quine('https://commons.wikimedia.org/wiki/File:At_the_dance_hop_(46265907185).jpg') },
  community: { src: sameSex, alt: 'Two men in a cap and a jacket swing dancing together. Anyone can lead or follow.', sample: true, focus: '50% 30%', credit: quine('https://commons.wikimedia.org/wiki/File:Same-sex_dancers.jpg') },
  soloJazz: { src: soloJazz, alt: 'A dancer in a floral blouse and high-waisted trousers doing solo jazz steps on a stage.', sample: true, focus: '50% 40%', credit: quine('https://commons.wikimedia.org/wiki/File:Hop_and_a_skip_(52876191506).jpg') },
  blackDress: { src: blackDress, alt: 'A dancer in a black dress spinning with her partner during a swing dance.', sample: true, focus: '45% 30%', credit: quine('https://commons.wikimedia.org/wiki/File:Lindy_Hop_dancer_in_black_dress.jpg') },
  blackYellow: { src: blackYellow, alt: 'A couple in black and yellow outfits smiling as they Lindy Hop together.', sample: true, focus: '55% 30%', credit: quine('https://commons.wikimedia.org/wiki/File:Lindy_Hop_dancers_in_black_and_yellow.jpg') },
  greenJumpsuit: { src: greenJumpsuit, alt: 'A dancer in a green jumpsuit doing a joyful kick step on the dance floor.', sample: true, focus: '62% 40%', credit: quine('https://commons.wikimedia.org/wiki/File:Skip_hop_(52961550362).jpg') },
} satisfies Record<string, Photo>;
