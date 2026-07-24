export const REVIEWED_PULSE_SNAPSHOT = {
  observedAt: "2026-07-24T06:03:23.000Z",
  collector: {
    sourceCount: 3,
    healthySourceCount: 3,
    candidateCount: 90,
    clusterCount: 70,
    activeCandidateCount: 39,
    reviewedOpportunityCount: 1,
  },
  opportunities: [
    {
      opportunityId: "nar_f5067918d8b31778",
      title: "Jimothy the raccoon becomes a multi-outlet viral character",
      summary:
        "A distinctive Seattle raccoon named Jimothy is being covered by multiple independent outlets as a recognizable internet character. The visual identity and repeatable name create a clear meme hook, but the original social post and prior tokenization still require verification.",
      status: "review",
      stage: "spreading",
      evidence: [
        {
          evidenceId: "cand_817910d786675079",
          sourceType: "rss",
          url: "https://news.google.com/rss/articles/CBMirgFBVV95cUxNNWtVbUtQRTNxUnpxaEtwVEFoZHZUelUyNVQ2UHhiY05TTzlvUllBZzFFLXhkX0xEem9vNFZoVUpjeDhwVFQ5RXgyVmJiT1ZCOXZHb29ZdTMxQ251cmJVcWQyM3gxMDhzUDI5bmpsai1NX3NrRG44ZC1xVDN6MUNoQnhxam1FeWZySzM0NW5sTmFpdmtHbWs5VTFqRklHaHFUZGxjanJzMVhKTHB2QkE?oc=5",
          publisher: "E! News",
          title:
            "Who Is Jimothy the Raccoon? Meet the Viral Animal Stealing Hearts, Not Trash",
          excerpt: null,
          publishedAt: "2026-07-23T02:00:00.000Z",
          capturedAt: "2026-07-24T06:03:15.000Z",
          status: "available",
        },
        {
          evidenceId: "cand_d2c6efa8358665d0",
          sourceType: "rss",
          url: "https://news.google.com/rss/articles/CBMinAFBVV95cUxNbTZDWGNrNFQ2d2t2QVBwT0QxRDN3T2V0LWZwbmVGbF9scUQ3STR6OHhGUTBBSXJNc3FEbmd6VGFnZWVOWkFDek9lOWJndk56LU1nTUxqdXlVMXF1Y0RNSE5ubl9oS2plY1lvdHZhU2hoazVqTWltT2hQYUZOemVUeDFJZkZuV3NPbklBOFIweW5XZDV5aV9CWHlKc2M?oc=5",
          publisher: "NEWS10 ABC",
          title:
            "Meet Jimothy, the Viral Seattle Raccoon With a Short Spine",
          excerpt: null,
          publishedAt: "2026-07-22T20:36:00.000Z",
          capturedAt: "2026-07-24T06:03:15.000Z",
          status: "available",
        },
      ],
      riskFlags: [
        "Original social post has not been verified.",
        "Prior tokenization and copycat saturation have not been checked.",
      ],
      missingEvidence: [
        "Original social post, author, and visible engagement band.",
        "Independent social remixes outside publisher coverage.",
        "GMGN duplicate and prior-tokenization check.",
      ],
      similarTokenCount: null,
      firstObservedAt: "2026-07-22T20:36:00.000Z",
      updatedAt: "2026-07-24T06:03:23.000Z",
    },
  ],
} as const;
