import { sanitizeDescription, sanitizeImageUrl } from '../../src/logic/content-sanitization'

describe('when sanitizing a description', () => {
  describe('and it embeds a TMP <link> tag to a custom protocol', () => {
    let result: string | null

    beforeEach(() => {
      result = sanitizeDescription('Join <link="decentraland://?position=0,0">click here</link>')
    })

    it('should strip both sides of the unsafe link and keep the inner text', () => {
      expect(result).toBe('Join click here')
    })
  })

  describe('and it embeds file:// and smb:// links', () => {
    let result: string | null

    beforeEach(() => {
      result = sanitizeDescription('a <link="file:///etc/passwd">x</link> b <link="smb://h/s">y</link> c')
    })

    it('should strip every unsafe link without leaving orphan tags', () => {
      expect(result).toBe('a x b y c')
    })
  })

  describe('and it embeds a safe https <link> tag', () => {
    let result: string | null

    beforeEach(() => {
      result = sanitizeDescription('Visit <link="https://decentraland.org">our site</link>')
    })

    it('should preserve the link tag untouched', () => {
      expect(result).toBe('Visit <link="https://decentraland.org">our site</link>')
    })
  })

  describe('and it mixes a safe and an unsafe link', () => {
    let result: string | null

    beforeEach(() => {
      result = sanitizeDescription('<link="https://a.com">A</link><link="javascript:alert(1)">B</link>')
    })

    it('should keep the safe link and strip the unsafe one', () => {
      expect(result).toBe('<link="https://a.com">A</link>B')
    })
  })

  describe('and a link tag carries extra content after the target', () => {
    let result: string | null

    beforeEach(() => {
      result = sanitizeDescription('<link=https://a.com onclick=x>t</link>')
    })

    it('should strip the ambiguous tag as a fail-safe', () => {
      expect(result).toBe('t')
    })
  })

  describe('and a malformed opener embeds a nested tag before its closing bracket', () => {
    let result: string | null

    beforeEach(() => {
      // Without failing closed, the outer `<link…` fragment would survive and the leftover
      // pieces could re-assemble into a live `<link="javascript:alert(1)">` opener.
      result = sanitizeDescription('<link="javascript:alert(1)"<b>>click</link>')
    })

    it('should not leave a live unsafe link in the output', () => {
      expect(result).not.toMatch(/<link/i)
    })
  })

  describe('and a link points at the cloud-metadata IP', () => {
    let result: string | null

    beforeEach(() => {
      result = sanitizeDescription('<link="http://169.254.169.254/latest/meta-data/">x</link>')
    })

    it('should strip it', () => {
      expect(result).toBe('x')
    })
  })

  describe('and a link points at an obfuscated loopback IP', () => {
    let result: string | null

    beforeEach(() => {
      // 2130706433 === 127.0.0.1; the URL parser normalizes it before the internal-host check.
      result = sanitizeDescription('<link="http://2130706433/">x</link>')
    })

    it('should strip it', () => {
      expect(result).toBe('x')
    })
  })

  describe('and a link points at a private or localhost host', () => {
    let result: string | null

    beforeEach(() => {
      result = sanitizeDescription('a <link="http://192.168.1.1/">x</link> b <link="http://localhost:8080/">y</link> c')
    })

    it('should strip both internal links', () => {
      expect(result).toBe('a x b y c')
    })
  })

  describe('and a link points at a single-label or reserved-suffix host', () => {
    let result: string | null

    beforeEach(() => {
      result = sanitizeDescription('a <link="http://router/">x</link> b <link="http://nas.local/">y</link> c')
    })

    it('should strip these local-looking hosts', () => {
      expect(result).toBe('a x b y c')
    })
  })

  describe('and a link points at a fully-qualified internal host (trailing dot)', () => {
    let result: string | null

    beforeEach(() => {
      result = sanitizeDescription('a <link="http://localhost./">x</link> b <link="http://router.local./">y</link> c')
    })

    it('should strip hosts whose trailing dot would otherwise bypass the check', () => {
      expect(result).toBe('a x b y c')
    })
  })

  describe('and a link points at a public host', () => {
    let result: string | null

    beforeEach(() => {
      result = sanitizeDescription('<link="https://8.8.8.8/">x</link>')
    })

    it('should keep it', () => {
      expect(result).toBe('<link="https://8.8.8.8/">x</link>')
    })
  })

  describe('and it contains prose with comparison operators', () => {
    let result: string | null

    beforeEach(() => {
      result = sanitizeDescription('Open 5 < 10 hours & counting')
    })

    it('should leave non-tag angle brackets and ampersands untouched', () => {
      expect(result).toBe('Open 5 < 10 hours & counting')
    })
  })

  describe('and it contains a generic markup tag', () => {
    let result: string | null

    beforeEach(() => {
      result = sanitizeDescription('bold <b>text</b> here')
    })

    it('should strip the tag and keep the text', () => {
      expect(result).toBe('bold text here')
    })
  })

  describe('and it is null', () => {
    let result: string | null

    beforeEach(() => {
      result = sanitizeDescription(null)
    })

    it('should return null', () => {
      expect(result).toBeNull()
    })
  })

  describe('and it is an empty string', () => {
    let result: string | null

    beforeEach(() => {
      result = sanitizeDescription('')
    })

    it('should return null', () => {
      expect(result).toBeNull()
    })
  })
})

describe('when sanitizing an image url', () => {
  describe('and it is a valid https url', () => {
    let result: string | null

    beforeEach(() => {
      result = sanitizeImageUrl('https://cdn.decentraland.org/thumb.png')
    })

    it('should return the normalized url', () => {
      expect(result).toBe('https://cdn.decentraland.org/thumb.png')
    })
  })

  describe('and it contains HTML-breakout characters', () => {
    let result: string | null

    beforeEach(() => {
      result = sanitizeImageUrl('https://a"><script>alert(1)</script><meta name="x')
    })

    it('should return null so the payload is never stored', () => {
      expect(result).toBeNull()
    })
  })

  describe('and it uses a non-http(s) protocol', () => {
    let result: string | null

    beforeEach(() => {
      result = sanitizeImageUrl('javascript:alert(document.domain)')
    })

    it('should return null', () => {
      expect(result).toBeNull()
    })
  })

  describe('and it points at the cloud-metadata host', () => {
    let result: string | null

    beforeEach(() => {
      result = sanitizeImageUrl('https://169.254.169.254/latest/meta-data/')
    })

    it('should return null', () => {
      expect(result).toBeNull()
    })
  })

  describe('and it points at a private host', () => {
    let result: string | null

    beforeEach(() => {
      result = sanitizeImageUrl('https://10.0.0.1/thumb.png')
    })

    it('should return null', () => {
      expect(result).toBeNull()
    })
  })

  describe('and it points at a fully-qualified localhost (trailing dot)', () => {
    let result: string | null

    beforeEach(() => {
      result = sanitizeImageUrl('https://localhost./thumb.png')
    })

    it('should return null', () => {
      expect(result).toBeNull()
    })
  })

  describe('and it is undefined', () => {
    let result: string | null

    beforeEach(() => {
      result = sanitizeImageUrl(undefined)
    })

    it('should return null', () => {
      expect(result).toBeNull()
    })
  })
})
