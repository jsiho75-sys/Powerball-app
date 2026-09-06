/*
============================================================
POWERBALL AI LAB v5
CLOUDFLARE WORKER
============================================================

Purpose:
- Retrieve current Powerball information
- Retrieve previous drawing results
- Normalize the data
- Return JSON to index.html
- Add CORS headers for browser access

Endpoint:
GET /

Example response:

{
  "source": "https://www.powerball.com/",
  "updatedAt": "2026-09-05T...",
  "jackpot": "$173 Million",
  "cashValue": "$74.6 Million",
  "nextDrawing": "...",
  "draws": [
    {
      "date": "2026-09-02",
      "white": [3,10,29,58,64],
      "powerball": 14
    }
  ]
}

============================================================
*/


/* =========================================================
   CONFIGURATION
========================================================= */

const POWERBALL_HOME =
  "https://www.powerball.com/";

const POWERBALL_RESULTS =
  "https://www.powerball.com/previous-results";


/*
  "*" allows your GitHub Pages app to call this Worker.

  Later, for tighter security, you can replace "*"
  with your exact GitHub Pages domain.
*/

const ALLOWED_ORIGIN = "*";


/* =========================================================
   CLOUDFLARE WORKER ENTRY POINT
========================================================= */

export default {

  async fetch(request, env, ctx) {

    /*
      Handle browser CORS preflight.
    */

    if (
      request.method === "OPTIONS"
    ) {

      return new Response(
        null,
        {
          status: 204,
          headers: corsHeaders()
        }
      );

    }


    /*
      Only GET is needed.
    */

    if (
      request.method !== "GET"
    ) {

      return jsonResponse(
        {
          error:
            "Only GET requests are supported."
        },
        405
      );

    }


    try {

      /*
        Retrieve both pages in parallel.

        This reduces total response time.
      */

      const responses =
        await Promise.all([

          fetch(
            POWERBALL_HOME,
            {
              headers: {
                "User-Agent":
                  "Powerball-AI-Lab/5.0"
              },
              cf: {
                cacheTtl: 300,
                cacheEverything: true
              }
            }
          ),

          fetch(
            POWERBALL_RESULTS,
            {
              headers: {
                "User-Agent":
                  "Powerball-AI-Lab/5.0"
              },
              cf: {
                cacheTtl: 300,
                cacheEverything: true
              }
            }
          )

        ]);


      const homeResponse =
        responses[0];

      const resultsResponse =
        responses[1];


      /*
        Make sure both requests succeeded.
      */

      if (
        !homeResponse.ok
      ) {

        throw new Error(
          "Powerball home page returned HTTP " +
          homeResponse.status
        );

      }


      if (
        !resultsResponse.ok
      ) {

        throw new Error(
          "Powerball results page returned HTTP " +
          resultsResponse.status
        );

      }


      /*
        Convert responses to text.
      */

      const homeHTML =
        await homeResponse.text();

      const resultsHTML =
        await resultsResponse.text();


      /*
        Parse current jackpot information.
      */

      const homeText =
        cleanHTML(
          homeHTML
        );


      const jackpot =
        findMoneyAfterLabel(
          homeText,
          "Estimated Jackpot"
        );


      const cashValue =
        findMoneyAfterLabel(
          homeText,
          "Cash Value"
        );


      /*
        Parse next drawing.
      */

      const nextDrawing =
        parseNextDrawing(
          homeText
        );


      /*
        Parse historical drawings.
      */

      const draws =
        parsePowerballResults(
          resultsHTML
        );


      /*
        We require at least one valid result.

        This prevents the Worker from returning
        apparently valid JSON with an empty database
        if Powerball changes its page format.
      */

      if (
        draws.length === 0
      ) {

        throw new Error(
          "No valid Powerball drawings were found."
        );

      }


      /*
        Return normalized data.
      */

      return jsonResponse({

        source:
          POWERBALL_HOME,

        resultsSource:
          POWERBALL_RESULTS,

        updatedAt:
          new Date().toISOString(),

        jackpot:
          jackpot,

        cashValue:
          cashValue,

        nextDrawing:
          nextDrawing,

        draws:
          draws

      });

    }

    catch (error) {

      console.error(
        "Powerball Worker error:",
        error
      );


      return jsonResponse(
        {

          error:
            error.message ||
            "Unknown Worker error.",

          updatedAt:
            new Date().toISOString()

        },
        502
      );

    }

  }

};


/* =========================================================
   CORS
========================================================= */

function corsHeaders(
  additional = {}
) {

  return {

    "Access-Control-Allow-Origin":
      ALLOWED_ORIGIN,

    "Access-Control-Allow-Methods":
      "GET, OPTIONS",

    "Access-Control-Allow-Headers":
      "Content-Type",

    "Access-Control-Max-Age":
      "86400",

    ...additional

  };

}


/* =========================================================
   JSON RESPONSE
========================================================= */

function jsonResponse(
  data,
  status = 200
) {

  return new Response(

    JSON.stringify(
      data,
      null,
      2
    ),

    {

      status,

      headers:
        corsHeaders({

          "Content-Type":
            "application/json; charset=utf-8",

          "Cache-Control":
            "no-store"

        })

    }

  );

}


/* =========================================================
   CLEAN HTML
========================================================= */

function cleanHTML(
  html
) {

  return html

    /*
      Remove JavaScript.
    */

    .replace(
      /<script[\s\S]*?<\/script>/gi,
      " "
    )

    /*
      Remove CSS.
    */

    .replace(
      /<style[\s\S]*?<\/style>/gi,
      " "
    )

    /*
      Remove HTML comments.
    */

    .replace(
      /<!--[\s\S]*?-->/g,
      " "
    )

    /*
      Remove HTML tags.
    */

    .replace(
      /<[^>]+>/g,
      " "
    )

    /*
      Decode common HTML entities.
    */

    .replace(
      /&nbsp;/gi,
      " "
    )

    .replace(
      /&amp;/gi,
      "&"
    )

    .replace(
      /&quot;/gi,
      '"'
    )

    .replace(
      /&#39;/gi,
      "'"
    )

    /*
      Collapse whitespace.
    */

    .replace(
      /\s+/g,
      " "
    )

    .trim();

}


/* =========================================================
   PARSE MONEY
========================================================= */

function findMoneyAfterLabel(
  text,
  label
) {

  /*
    Example:

    Estimated Jackpot $173 Million

    or:

    Estimated Jackpot
    $173 Million
  */

  const escapedLabel =
    label.replace(
      /[.*+?^${}()|[\]\\]/g,
      "\\$&"
    );


  const regex =
    new RegExp(
      escapedLabel +
      "\\s*\\$\\s*([0-9,.]+\\s*(?:Million|Billion)?)",
      "i"
    );


  const match =
    text.match(
      regex
    );


  if (!match) {

    return null;

  }


  return (
    "$" +
    match[1]
      .replace(
        /\s+/g,
        " "
      )
      .trim()
  );

}


/* =========================================================
   PARSE NEXT DRAWING
========================================================= */

function parseNextDrawing(
  text
) {

  /*
    We first look for the date.

    Example:

    Next Drawing Sat, Sep 5, 2026
  */

  const dateMatch =
    text.match(
      /Next\s+Drawing\s+([A-Z][a-z]{2},\s+[A-Z][a-z]{2}\s+\d{1,2},\s+\d{4})/i
    );


  if (!dateMatch) {

    return null;

  }


  const dateText =
    dateMatch[1];


  /*
    Powerball drawings occur at 10:59 PM Eastern Time.
  */

  const iso =
    easternDateToISO(
      dateText,
      "22:59:00"
    );


  return iso || dateText;

}


/* =========================================================
   EASTERN DATE TO ISO
========================================================= */

function easternDateToISO(
  dateText,
  timeText
) {

  /*
    JavaScript's Date parser does not consistently
    understand an arbitrary "ET" abbreviation.

    We therefore use the US Eastern offset explicitly.

    September is daylight time:

    EDT = UTC-04:00

    For winter dates, the helper below chooses
    UTC-05:00.
  */

  const monthMatch =
    dateText.match(
      /,\s+([A-Z][a-z]{2})\s+/
    );


  if (!monthMatch) {

    return null;

  }


  const monthName =
    monthMatch[1];


  const monthNumber =
    monthNumberFromName(
      monthName
    );


  if (!monthNumber) {

    return null;

  }


  const yearMatch =
    dateText.match(
      /(\d{4})$/
    );


  const dayMatch =
    dateText.match(
      /[A-Z][a-z]{2},\s+[A-Z][a-z]{2}\s+(\d{1,2}),/
    );


  if (
    !yearMatch ||
    !dayMatch
  ) {

    return null;

  }


  const year =
    Number(
      yearMatch[1]
    );


  const day =
    Number(
      dayMatch[1]
    );


  /*
    US Eastern DST approximation.

    This is sufficient for Powerball dates because
    the drawings occur on dates where US DST rules
    are predictable.

    We use Intl to determine the offset rather than
    hardcoding it for every date.
  */

  const baseUTC =
    new Date(
      Date.UTC(
        year,
        monthNumber - 1,
        day,
        22,
        59,
        0
      )
    );


  /*
    Determine whether the date is in EDT or EST.

    We use the US DST transition rules:
    second Sunday in March through first Sunday
    in November.
  */

  const offset =
    isUSDaylightTime(
      year,
      monthNumber,
      day
    )
      ? "-04:00"
      : "-05:00";


  const iso =
    `${year}-${String(monthNumber).padStart(2,"0")}-${String(day).padStart(2,"0")}T${timeText}${offset}`;


  return iso;

}


/* =========================================================
   MONTH NAME
========================================================= */

function monthNumberFromName(
  name
) {

  const months = {

    Jan: 1,
    Feb: 2,
    Mar: 3,
    Apr: 4,
    May: 5,
    Jun: 6,
    Jul: 7,
    Aug: 8,
    Sep: 9,
    Oct: 10,
    Nov: 11,
    Dec: 12

  };


  return months[name] || null;

}


/* =========================================================
   US DAYLIGHT TIME
========================================================= */

function isUSDaylightTime(
  year,
  month,
  day
) {

  /*
    Before March = standard time.
    After November = standard time.
  */

  if (
    month < 3 ||
    month > 11
  ) {

    return false;

  }


  if (
    month > 3 &&
    month < 11
  ) {

    return true;

  }


  /*
    Find the relevant Sunday.
  */

  if (
    month === 3
  ) {

    /*
      DST starts on the second Sunday in March.
    */

    const secondSunday =
      nthSunday(
        year,
        3,
        2
      );


    return day >= secondSunday;

  }


  if (
    month === 11
  ) {

    /*
      DST ends on the first Sunday in November.
    */

    const firstSunday =
      nthSunday(
        year,
        11,
        1
      );


    return day < firstSunday;

  }


  return false;

}


/* =========================================================
   NTH SUNDAY
========================================================= */

function nthSunday(
  year,
  month,
  n
) {

  const firstDay =
    new Date(
      Date.UTC(
        year,
        month - 1,
        1
      )
    );


  const firstSundayOffset =
    (
      7 -
      firstDay.getUTCDay()
    ) % 7;


  return (
    1 +
    firstSundayOffset +
    (n - 1) * 7
  );

}


/* =========================================================
   PARSE POWERBALL RESULTS
========================================================= */

function parsePowerballResults(
  html
) {

  /*
    Powerball's previous-results page contains
    result cards/links with the date followed by
    the winning numbers.

    We search anchor contents rather than trying to
    parse the entire HTML document as one huge string.
  */

  const anchors =
    [
      ...html.matchAll(
        /<a\b[^>]*>([\s\S]*?)<\/a>/gi
      )
    ];


  const results = [];

  const seenDates =
    new Set();


  for (
    const match of anchors
  ) {

    const anchorHTML =
      match[1];


    const text =
      cleanHTML(
        anchorHTML
      );


    /*
      Expected beginning:

      Wed, Sep 2, 2026 ...

    */

    const dateMatch =
      text.match(
        /^(Mon|Tue|Wed|Thu|Fri|Sat|Sun),\s+([A-Z][a-z]{2})\s+(\d{1,2}),\s+(\d{4})\s+(.+)$/i
      );


    if (!dateMatch) {

      continue;

    }


    const weekday =
      dateMatch[1];


    const month =
      dateMatch[2];


    const day =
      Number(
        dateMatch[3]
      );


    const year =
      Number(
        dateMatch[4]
      );


    /*
      Extract numbers after the date.
    */

    const numberText =
      dateMatch[5];


    const numberMatches =
      numberText.match(
        /\b\d{1,2}\b/g
      );


    if (!numberMatches) {

      continue;

    }


    const numbers =
      numberMatches.map(
        Number
      );


    /*
      A valid Powerball result needs:

      5 white balls
      1 Powerball

      Power Play numbers are not part of the
      winning-number sequence and are ignored.
    */

    if (
      numbers.length < 6
    ) {

      continue;

    }


    const white =
      numbers.slice(
        0,
        5
      );


    const powerball =
      numbers[5];


    /*
      Validate white balls.
    */

    if (
      white.length !== 5 ||
      new Set(white).size !== 5 ||
      white.some(
        n =>
          n < 1 ||
          n > 69
      )
    ) {

      continue;

    }


    /*
      Validate Powerball.
    */

    if (
      powerball < 1 ||
      powerball > 26
    ) {

      continue;

    }


    /*
      Build YYYY-MM-DD.
    */

    const date =
      `${year}-${String(
        monthNumberFromName(month)
      ).padStart(2,"0")}-${String(day).padStart(2,"0")}`;


    /*
      Prevent duplicate cards.
    */

    if (
      seenDates.has(date)
    ) {

      continue;

    }


    seenDates.add(
      date
    );


    results.push({

      date,

      white:
        white.sort(
          (a,b) => a-b
        ),

      powerball

    });

  }


  /*
    Sort oldest to newest.

    The iPhone app merges these results with
    its local database.
  */

  results.sort(
    (a,b) =>
      a.date.localeCompare(
        b.date
      )
  );


  return results;

}
