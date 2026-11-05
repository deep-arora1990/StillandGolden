// The wedding agreement wording, in one place.
//
// The PDF (submit-wedding-agreement) and the page (wedding-agreement.html) both
// read these words. wedding-agreement.html shows the same text with the lead
// phrases in <strong>, and a test keeps the two in step: change a sentence here
// and the page must change with it.
//
// No price is typed here. Package names and hours come from TIERS, and there is
// no fallback to any other package: a key that is not a wedding package throws.

const { TIERS } = require('./setmore')

const WEDDING_AGREEMENT_TITLE = 'Wedding Photography Agreement'

const PACKAGE_COVERS = {
  'wedding-short': 'The ceremony, your people, the two of you, and whatever comes after (gelato, pizza in the city, you name it).',
  'wedding-full': 'The ceremony, your people, the two of you and whatever comes after, plus getting ready, and the long lunch or dinner with speeches and dancing.',
}

const INCLUDED_COMMON = [
  "Both packages include a planning call 4 to 6 weeks before the wedding, a short questionnaire so I know who's who, and every edited photo in a private online gallery within 4 weeks of the wedding, as high-resolution JPEG files for personal use. Your gallery stays online for 3 months from delivery, so download your favourites early.",
  "Coverage is for the hours of the package booked, on the wedding date. We'll work out the timing together on the planning call.",
  'Travel is included anywhere in South-east Melbourne, the Mornington Peninsula, Inner Melbourne and the City registry office.',
]

const SHARED_SECTIONS = [
  {
    title: 'Payment Terms',
    paras: [
      "Paying secures your wedding date. You can pay the full fee when you book, or pay half when you book and the other half 4 weeks later, charged automatically to the same card. You'll get a reminder three days before the second payment, and nothing is charged after it.",
      'Paying in two halves is only offered when the wedding is at least 5 weeks away, so the full fee is always paid before the wedding.',
      "If the second payment doesn't go through, your date is still booked. You'll be emailed a link to pay with another card, and the full fee must be paid before the wedding day.",
      'The fee is the price of the package you booked, less any promo code used at booking. A gift voucher used at booking counts as payment towards the fee.',
    ],
  },
  {
    title: 'Cancellation & Rescheduling',
    paras: [
      "If you cancel at least 14 days (2 weeks) before the wedding date, everything you've paid is refunded in full, and any payment still to come is cancelled.",
      "If you cancel fewer than 14 days before the wedding date, half the fee is refunded. If only the first half has been paid by then, it isn't refunded and the second payment is cancelled, so cancelling never costs more than half the fee.",
      'Where a refund covers part of the fee paid with a gift voucher, that part goes back on the voucher rather than being refunded as money.',
      "If I can't be there. I'll do everything I can to be at your wedding. If illness or an emergency means the photographer can't attend, everything you've paid is refunded in full, and any payment still to come is cancelled. The photographer doesn't send a replacement.",
      "If you postpone. Before you lock in a new date, talk to all your suppliers, the photographer included, and get their availability for a handful of dates. If the photographer is free on your new date, your booking and everything you've paid move to it, and a second payment is still taken on its original date. If the photographer isn't free on any of your dates, it's treated as a cancellation by you, and the refund rules above apply, measured from the original wedding date.",
    ],
  },
  {
    title: 'Image Usage & Rights',
    paras: [
      'Your use: Images are licensed for personal, non-commercial use only. You may print, share, and display images for personal purposes. Commercial use of any image is strictly prohibited without prior written consent from Still & Golden Photography.',
      'Photographer use: Still & Golden Photography retains full copyright of all images. The photographer reserves the right to use images for portfolio, website, social media, and other promotional purposes. If you would prefer your images not be used publicly, please notify the photographer in writing before the wedding.',
      "Sharing on socials: If you'd rather your photos weren't shared on my socials, just let me know before the wedding. A reply to any of my emails is fine, and it won't change a thing about your day or your gallery.",
    ],
  },
  {
    title: 'General',
    paras: [
      'This agreement is the entire agreement between the two of you and Still & Golden Photography for your wedding photography, and is governed by the laws of Victoria, Australia. You each confirm you have read, understood and agree to it by ticking your own box below.',
    ],
  },
]

function assertWedding(tierKey) {
  if (!tierKey || !Object.prototype.hasOwnProperty.call(TIERS, tierKey) || TIERS[tierKey].wedding !== true) {
    throw new Error('Not a wedding package: ' + tierKey)
  }
}

function packageLine(tierKey) {
  assertWedding(tierKey)
  const t = TIERS[tierKey]
  return `Package booked: ${t.name}, ${t.lengthLabel} of wedding photography. ${PACKAGE_COVERS[tierKey]}`
}

function weddingAgreementSections(tierKey) {
  assertWedding(tierKey)
  return {
    title: WEDDING_AGREEMENT_TITLE,
    sections: [
      { title: "What's Included", paras: [packageLine(tierKey), ...INCLUDED_COMMON] },
      ...SHARED_SECTIONS,
    ],
  }
}

module.exports = {
  WEDDING_AGREEMENT_TITLE,
  PACKAGE_COVERS,
  INCLUDED_COMMON,
  SHARED_SECTIONS,
  packageLine,
  weddingAgreementSections,
}
