/**
 * The picture vocabulary the kart chase drives through.
 *
 * Pictures are emoji rather than image files on purpose: they are drawn into a
 * canvas texture exactly like the answer cards and the word-connect letters, so
 * there is nothing to fetch and nothing that can 404 — the same reasoning that
 * keeps `AudioManager` synthesising its own sounds.
 *
 * Every item carries its English word as well as its picture. The chase asks
 * "is this one of the ANIMALS?", and the word underneath is what makes that a
 * vocabulary lesson rather than a shape-matching test.
 *
 * ## Why items are tagged rather than nested under a topic
 *
 * A picture can honestly belong to more than one category, and an earlier
 * version of this file — a list of topics that each owned their own items —
 * could not express that. It produced rounds that were not answerable: a
 * bicycle offered as a decoy against SPORTS, a boxing glove against CLOTHES, a
 * tree against ANIMALS when animals are plainly part of nature too.
 *
 * So membership lives on the item instead:
 *
 * - `topics` is what the picture genuinely **is**. It may be more than one, and
 *   the item is a valid answer for every topic listed.
 * - `avoid` is for topics it is *not* in but could fairly be argued into. The
 *   item is never offered as a decoy for those. An unfair decoy is far worse
 *   than one fewer decoy: it turns a vocabulary question into a guess.
 *
 * Between them, a picture is either clearly right or clearly wrong for whatever
 * topic is running — never "well, sort of".
 */

export type PictureTopicId =
  | 'animals'
  | 'food'
  | 'vehicles'
  | 'clothes'
  | 'sports'
  | 'instruments'
  | 'weather'
  | 'body';

export interface PictureItem {
  emoji: string;
  /** The English word for the picture, shown under it. */
  word: string;
  /** Topics this picture genuinely belongs to. */
  topics: readonly PictureTopicId[];
  /** Topics it does not belong to, but is too arguable to use as a decoy for. */
  avoid?: readonly PictureTopicId[];
}

export interface PictureTopic {
  id: PictureTopicId;
  /** Shown to the player, in the chase prompt and on the roadside signs. */
  label: string;
  /** Every picture that counts as an answer for this topic. */
  items: readonly PictureItem[];
}

/**
 * Topic names, chosen to be mutually exclusive.
 *
 * Deliberately no "NATURE" (it contains the animals, the fruit and the weather)
 * and no "THINGS AT HOME" (it contains the furniture, the instruments, the
 * clothes and the food). A category the learner cannot draw a line around is
 * not a question.
 */
const TOPIC_LABELS: Record<PictureTopicId, string> = {
  animals: 'ANIMALS',
  food: 'FOOD',
  vehicles: 'VEHICLES',
  clothes: 'CLOTHES',
  sports: 'SPORTS',
  instruments: 'INSTRUMENTS',
  weather: 'WEATHER',
  body: 'BODY PARTS',
};

export const PICTURE_ITEMS: readonly PictureItem[] = [
  // ------------------------------------------------------------- animals --
  { emoji: '🐶', word: 'DOG', topics: ['animals'] },
  { emoji: '🐱', word: 'CAT', topics: ['animals'] },
  { emoji: '🐘', word: 'ELEPHANT', topics: ['animals'] },
  { emoji: '🦁', word: 'LION', topics: ['animals'] },
  { emoji: '🐸', word: 'FROG', topics: ['animals'] },
  { emoji: '🦉', word: 'OWL', topics: ['animals'] },
  { emoji: '🐝', word: 'BEE', topics: ['animals'] },
  { emoji: '🐬', word: 'DOLPHIN', topics: ['animals'] },
  { emoji: '🐢', word: 'TURTLE', topics: ['animals'] },
  { emoji: '🦊', word: 'FOX', topics: ['animals'] },
  { emoji: '🐍', word: 'SNAKE', topics: ['animals'] },
  { emoji: '🐧', word: 'PENGUIN', topics: ['animals'] },
  // Beef is food; a cow is not. Too fine a line to draw at speed.
  { emoji: '🐮', word: 'COW', topics: ['animals'], avoid: ['food'] },
  // You ride one, so never a decoy for the things you travel in.
  { emoji: '🐴', word: 'HORSE', topics: ['animals'], avoid: ['vehicles'] },

  // ---------------------------------------------------------------- food --
  { emoji: '🍎', word: 'APPLE', topics: ['food'] },
  { emoji: '🍞', word: 'BREAD', topics: ['food'] },
  { emoji: '🧀', word: 'CHEESE', topics: ['food'] },
  { emoji: '🍕', word: 'PIZZA', topics: ['food'] },
  { emoji: '🍌', word: 'BANANA', topics: ['food'] },
  { emoji: '🥕', word: 'CARROT', topics: ['food'] },
  { emoji: '🍚', word: 'RICE', topics: ['food'] },
  { emoji: '🍰', word: 'CAKE', topics: ['food'] },
  { emoji: '🍓', word: 'STRAWBERRY', topics: ['food'] },
  { emoji: '🍜', word: 'NOODLES', topics: ['food'] },
  { emoji: '🍇', word: 'GRAPES', topics: ['food'] },
  { emoji: '🥗', word: 'SALAD', topics: ['food'] },
  // Comes from a bird, which is close enough to trip a learner up.
  { emoji: '🥚', word: 'EGG', topics: ['food'], avoid: ['animals'] },

  // ------------------------------------------------------------ vehicles --
  { emoji: '🚗', word: 'CAR', topics: ['vehicles'] },
  { emoji: '🚌', word: 'BUS', topics: ['vehicles'] },
  { emoji: '✈️', word: 'PLANE', topics: ['vehicles'] },
  { emoji: '🚂', word: 'TRAIN', topics: ['vehicles'] },
  { emoji: '🚢', word: 'SHIP', topics: ['vehicles'] },
  { emoji: '🚁', word: 'HELICOPTER', topics: ['vehicles'] },
  { emoji: '🛵', word: 'SCOOTER', topics: ['vehicles'] },
  { emoji: '🚕', word: 'TAXI', topics: ['vehicles'] },
  { emoji: '🚚', word: 'TRUCK', topics: ['vehicles'] },
  { emoji: '🚀', word: 'ROCKET', topics: ['vehicles'] },
  // Cycling and sailing are both sports, so neither is a fair sports decoy.
  { emoji: '🚲', word: 'BICYCLE', topics: ['vehicles'], avoid: ['sports'] },
  { emoji: '⛵', word: 'SAILBOAT', topics: ['vehicles'], avoid: ['sports'] },

  // ------------------------------------------------------------- clothes --
  { emoji: '👕', word: 'SHIRT', topics: ['clothes'] },
  { emoji: '👖', word: 'JEANS', topics: ['clothes'] },
  { emoji: '🧣', word: 'SCARF', topics: ['clothes'] },
  { emoji: '👗', word: 'DRESS', topics: ['clothes'] },
  { emoji: '🧥', word: 'COAT', topics: ['clothes'] },
  { emoji: '🎩', word: 'HAT', topics: ['clothes'] },
  { emoji: '🧦', word: 'SOCKS', topics: ['clothes'], avoid: ['sports'] },
  { emoji: '👞', word: 'BOOTS', topics: ['clothes'] },
  { emoji: '👔', word: 'TIE', topics: ['clothes'] },
  // Kit you wear to play in: right for CLOTHES, unfair against SPORTS.
  { emoji: '🧢', word: 'CAP', topics: ['clothes'], avoid: ['sports'] },
  { emoji: '🧤', word: 'GLOVES', topics: ['clothes'], avoid: ['sports'] },
  { emoji: '👟', word: 'SHOES', topics: ['clothes'], avoid: ['sports'] },

  // -------------------------------------------------------------- sports --
  // Equipment only. A picture of a *person* running or swimming reads as a
  // body as readily as it reads as a sport, so none are in the bank.
  { emoji: '⚽', word: 'FOOTBALL', topics: ['sports'] },
  { emoji: '🏀', word: 'BASKETBALL', topics: ['sports'] },
  { emoji: '🎾', word: 'TENNIS', topics: ['sports'] },
  { emoji: '🏐', word: 'VOLLEYBALL', topics: ['sports'] },
  { emoji: '🏸', word: 'BADMINTON', topics: ['sports'] },
  { emoji: '🏓', word: 'TABLE TENNIS', topics: ['sports'] },
  { emoji: '🎳', word: 'BOWLING', topics: ['sports'] },
  { emoji: '⛳', word: 'GOLF', topics: ['sports'] },
  { emoji: '🏒', word: 'HOCKEY', topics: ['sports'] },
  { emoji: '🎿', word: 'SKIING', topics: ['sports'] },
  { emoji: '🥏', word: 'FRISBEE', topics: ['sports'] },
  { emoji: '🏹', word: 'ARCHERY', topics: ['sports'] },

  // --------------------------------------------------------- instruments --
  { emoji: '🎸', word: 'GUITAR', topics: ['instruments'] },
  { emoji: '🥁', word: 'DRUM', topics: ['instruments'] },
  { emoji: '🎺', word: 'TRUMPET', topics: ['instruments'] },
  { emoji: '🎹', word: 'PIANO', topics: ['instruments'] },
  { emoji: '🎻', word: 'VIOLIN', topics: ['instruments'] },
  { emoji: '🎷', word: 'SAXOPHONE', topics: ['instruments'] },
  { emoji: '🪕', word: 'BANJO', topics: ['instruments'] },
  { emoji: '🪗', word: 'ACCORDION', topics: ['instruments'] },
  { emoji: '🎤', word: 'MICROPHONE', topics: ['instruments'] },

  // ------------------------------------------------------------- weather --
  { emoji: '☀️', word: 'SUN', topics: ['weather'] },
  { emoji: '🌧️', word: 'RAIN', topics: ['weather'] },
  { emoji: '❄️', word: 'SNOW', topics: ['weather'] },
  { emoji: '☁️', word: 'CLOUD', topics: ['weather'] },
  { emoji: '🌈', word: 'RAINBOW', topics: ['weather'] },
  { emoji: '⛈️', word: 'STORM', topics: ['weather'] },
  { emoji: '🌪️', word: 'TORNADO', topics: ['weather'] },
  { emoji: '⚡', word: 'LIGHTNING', topics: ['weather'] },
  { emoji: '💨', word: 'WIND', topics: ['weather'] },
  { emoji: '🌫️', word: 'FOG', topics: ['weather'] },

  // ---------------------------------------------------------- body parts --
  { emoji: '👁️', word: 'EYE', topics: ['body'] },
  { emoji: '👂', word: 'EAR', topics: ['body'] },
  { emoji: '👃', word: 'NOSE', topics: ['body'] },
  { emoji: '👄', word: 'MOUTH', topics: ['body'] },
  { emoji: '🦶', word: 'FOOT', topics: ['body'] },
  { emoji: '🖐️', word: 'HAND', topics: ['body'] },
  { emoji: '🦷', word: 'TOOTH', topics: ['body'] },
  { emoji: '🧠', word: 'BRAIN', topics: ['body'] },
  { emoji: '🦵', word: 'LEG', topics: ['body'] },
  { emoji: '👅', word: 'TONGUE', topics: ['body'] },
  { emoji: '🫀', word: 'HEART', topics: ['body'] },
  // A flexed bicep is as much a gym picture as an anatomy one.
  { emoji: '💪', word: 'ARM', topics: ['body'], avoid: ['sports'] },
];

/** Topics, each resolved to the items that answer it. */
export const PICTURE_TOPICS: readonly PictureTopic[] = (
  Object.keys(TOPIC_LABELS) as PictureTopicId[]
).map((id) => ({
  id,
  label: TOPIC_LABELS[id],
  items: PICTURE_ITEMS.filter((item) => item.topics.includes(id)),
}));

/** Fisher–Yates, on a copy. */
function shuffle<T>(items: readonly T[]): T[] {
  const out = items.slice();
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/**
 * A topic for one chase.
 * @param exclude the previous chase's topic, so two in a row are never the same.
 */
export function pickTopic(exclude: string | null = null): PictureTopic {
  const choices = PICTURE_TOPICS.filter((topic) => topic.id !== exclude);
  const pool = choices.length > 0 ? choices : PICTURE_TOPICS;
  return pool[Math.floor(Math.random() * pool.length)];
}

/** `count` distinct pictures that belong to `topic`. */
export function pickMatches(topic: PictureTopic, count: number): PictureItem[] {
  return shuffle(topic.items).slice(0, count);
}

/**
 * `count` distinct pictures that are plainly **not** in `topic`.
 *
 * Anything naming the topic — as a real membership or as an `avoid` — is out,
 * so a decoy is never something the player could reasonably argue for. Drawn
 * from every remaining topic at once rather than from a single one, so a row's
 * decoys never all come from the same category, which would let the player
 * learn the shape of a row instead of the vocabulary.
 */
export function pickDecoys(topic: PictureTopic, count: number): PictureItem[] {
  const usable = PICTURE_ITEMS.filter(
    (item) => !item.topics.includes(topic.id) && !item.avoid?.includes(topic.id),
  );
  return shuffle(usable).slice(0, count);
}
