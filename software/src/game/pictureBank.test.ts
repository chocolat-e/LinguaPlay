import { describe, expect, it } from 'vitest';
import {
  PICTURE_ITEMS,
  PICTURE_TOPICS,
  pickDecoys,
  pickMatches,
  pickTopic,
  type PictureTopicId,
} from './pictureBank';
import { KART_WAVES } from './constants';

/**
 * The chase is only a vocabulary question if a picture is either clearly in the
 * topic or clearly out of it. These are the rules that keep it that way — the
 * bank is hand-written data, and the failure mode is a plausible-looking item
 * that quietly makes a topic unanswerable.
 */
describe('the picture bank keeps every topic answerable', () => {
  it('gives every item at least one topic', () => {
    for (const item of PICTURE_ITEMS) {
      expect(item.topics.length, `${item.word} has a topic`).toBeGreaterThan(0);
    }
  });

  it('never lists a topic as both a membership and an avoid', () => {
    // `avoid` means "not in this topic, but arguable". Saying both is a
    // contradiction, and would silently shrink the decoy pool.
    for (const item of PICTURE_ITEMS) {
      for (const topic of item.avoid ?? []) {
        expect(item.topics, `${item.word}`).not.toContain(topic);
      }
    }
  });

  it('uses no word twice', () => {
    const words = PICTURE_ITEMS.map((item) => item.word);
    expect(new Set(words).size).toBe(words.length);
  });

  it('names every topic exactly once', () => {
    const ids = PICTURE_TOPICS.map((topic) => topic.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const topic of PICTURE_TOPICS) {
      expect(topic.label.length).toBeGreaterThan(2);
    }
  });

  // A chase is KART_WAVES rows of up to two matches and two decoys each. Both
  // pools have to be comfortably bigger than that or rows start repeating.
  it('gives every topic enough pictures to fill a whole chase', () => {
    for (const topic of PICTURE_TOPICS) {
      expect(topic.items.length, `${topic.label} matches`).toBeGreaterThanOrEqual(8);
      expect(
        pickDecoys(topic, 999).length,
        `${topic.label} decoys`,
      ).toBeGreaterThanOrEqual(KART_WAVES * 2);
    }
  });

  it('never offers a decoy the player could argue belongs to the topic', () => {
    for (const topic of PICTURE_TOPICS) {
      for (const decoy of pickDecoys(topic, 999)) {
        expect(decoy.topics, `${decoy.word} vs ${topic.label}`).not.toContain(topic.id);
        expect(decoy.avoid ?? [], `${decoy.word} vs ${topic.label}`).not.toContain(topic.id);
      }
    }
  });

  it('only ever offers matches that really are in the topic', () => {
    for (const topic of PICTURE_TOPICS) {
      for (const match of pickMatches(topic, 999)) {
        expect(match.topics, `${match.word} vs ${topic.label}`).toContain(topic.id);
      }
    }
  });

  it('lets one picture answer more than one topic', () => {
    // Not a rule so much as the reason the data is shaped this way: the old
    // one-topic-owns-its-items layout could not express this at all.
    const shared = PICTURE_ITEMS.filter(
      (item) => item.topics.length > 1 || (item.avoid?.length ?? 0) > 0,
    );
    expect(shared.length).toBeGreaterThan(0);
  });

  it('picks a different topic from the one just played', () => {
    for (const topic of PICTURE_TOPICS) {
      for (let i = 0; i < 30; i += 1) {
        expect(pickTopic(topic.id).id).not.toBe(topic.id);
      }
    }
  });
});

/** The overlaps that made the first version of this bank unfair. */
describe('the specific traps that broke the first bank', () => {
  const topicOf = (id: PictureTopicId) => {
    const topic = PICTURE_TOPICS.find((entry) => entry.id === id);
    if (!topic) throw new Error(`No topic ${id}`);
    return topic;
  };

  const cases: Array<[PictureTopicId, string]> = [
    ['sports', 'BICYCLE'],   // cycling is a sport
    ['sports', 'SAILBOAT'],  // so is sailing
    ['sports', 'SHOES'],     // trainers
    ['sports', 'GLOVES'],
    ['sports', 'CAP'],
    ['sports', 'ARM'],       // a flexed bicep reads as the gym
    ['sports', 'SOCKS'],     // sports socks
    ['food', 'COW'],         // beef is food, a cow is not
    ['vehicles', 'HORSE'],   // you ride one
    ['animals', 'EGG'],      // close enough to a bird to be unfair
  ];

  for (const [id, word] of cases) {
    it(`never uses ${word} as a decoy against ${id.toUpperCase()}`, () => {
      const decoys = pickDecoys(topicOf(id), 999).map((item) => item.word);
      expect(decoys).not.toContain(word);
    });
  }
});
