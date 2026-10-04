/** Small HTML helpers shared by the adapters. */

/**
 * Remove every tag, repeating until none are left (a single pass can leave a tag behind, e.g.
 * "<scr<script>ipt>"; CodeQL js/incomplete-multi-character-sanitization). Pass " " as the
 * replacement when text from neighbouring elements must not run together
 * ("<span>10:30pm</span><span>Live Music</span>" -> "10:30pm Live Music").
 */
export function stripTags(s: string, replacement = ''): string {
  let prev: string;
  do {
    prev = s;
    s = s.replace(/<[^<>]*>/g, replacement);
  } while (s !== prev);
  return s;
}
