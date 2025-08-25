const { Client } = require('@notionhq/client');
const { Resend } = require('resend');
require('dotenv').config();

// Initialize clients
const notion = new Client({ auth: process.env.NOTION_API_KEY });
const resend = new Resend(process.env.RESEND_API_KEY);

// Configuration
const DATABASE_ID = process.env.NOTION_DATABASE_ID;
const EMAIL_TO = process.env.REPORT_EMAIL_TO;
const EMAIL_FROM = process.env.REPORT_EMAIL_FROM || 'Investment Tracker <onboarding@resend.dev>';
const DRY_RUN = process.argv.includes('--dry-run');

// Date helpers
const today = new Date();
today.setHours(0, 0, 0, 0);

const tomorrow = new Date(today);
tomorrow.setDate(tomorrow.getDate() + 1);

const nextWeek = new Date(today);
nextWeek.setDate(nextWeek.getDate() + 7);

const nextMonth = new Date(today);
nextMonth.setDate(nextMonth.getDate() + 30);

async function fetchInvestments() {
  try {
    const response = await notion.databases.query({
      database_id: DATABASE_ID,
      filter: {
        and: [
          {
            property: 'Deal stage',
            status: {
              does_not_equal: 'On hold'
            }
          },
          {
            property: 'Deal stage',
            status: {
              does_not_equal: 'Complete'
            }
          },
          {
            property: 'Deal stage',
            status: {
              does_not_equal: 'Passed'
            }
          },
          {
            property: 'Deal stage',
            status: {
              does_not_equal: 'Invested'
            }
          }
        ]
      },
      sorts: [
        {
          property: 'Next action date',
          direction: 'ascending',
        },
      ],
    });
    return response.results;
  } catch (error) {
    console.error('Error fetching from Notion:', error);
    throw error;
  }
}

function categorizeInvestments(investments) {
  const categorized = {
    overdue: [],
    dueToday: [],
    thisWeek: [],
    thisMonth: [],
    all: investments,
  };

  investments.forEach(item => {
    // Extract properties - adjusted to match your database schema
    const nextActionDate = item.properties['Next action date']?.date?.start;
    
    if (!nextActionDate) return;
    
    const actionDate = new Date(nextActionDate);
    actionDate.setHours(0, 0, 0, 0);
    
    const investment = {
      id: item.id,
      companyName: item.properties['Name']?.title?.[0]?.plain_text || 'Unknown',
      nextActionDate: nextActionDate,
      nextAction: item.properties['Next action']?.rich_text?.[0]?.plain_text || 'No action specified',
      amount: item.properties['Investment Amount']?.number || 0,
      status: item.properties['Engagement status']?.status?.name || item.properties['Deal stage']?.status?.name || 'Active',
      notes: item.properties['Notes']?.rich_text?.[0]?.plain_text || '',
      poc: item.properties['Primary POC']?.rich_text?.[0]?.plain_text || 'Not specified',
      url: item.url,
    };

    if (actionDate < today) {
      categorized.overdue.push(investment);
    } else if (actionDate.getTime() === today.getTime()) {
      categorized.dueToday.push(investment);
    } else if (actionDate < nextWeek) {
      categorized.thisWeek.push(investment);
    } else if (actionDate < nextMonth) {
      categorized.thisMonth.push(investment);
    }
  });

  return categorized;
}

function generateEmailHTML(categorized) {
  const formatCurrency = (amount) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 0,
    }).format(amount);
  };

  const formatDate = (dateStr) => {
    // Parse the date string as local date to avoid timezone offset issues
    const [year, month, day] = dateStr.split('-');
    const date = new Date(year, month - 1, day);
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  };

  const daysSince = (dateStr) => {
    // Parse the date string as local date to avoid timezone offset issues
    const [year, month, day] = dateStr.split('-');
    const date = new Date(year, month - 1, day);
    date.setHours(0, 0, 0, 0);
    const diff = today - date;
    return Math.floor(diff / (1000 * 60 * 60 * 24));
  };

  let html = `
    <!DOCTYPE html>
    <html>
    <head>
      <style>
        body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.6; color: #333; }
        .container { max-width: 600px; margin: 0 auto; padding: 20px; }
        h1 { color: #2c3e50; border-bottom: 3px solid #3498db; padding-bottom: 10px; }
        h2 { color: #34495e; margin-top: 30px; }
        .alert { background: #ffe5e5; border-left: 4px solid #ff4444; padding: 12px; margin: 15px 0; }
        .warning { background: #fff3cd; border-left: 4px solid #ffb744; padding: 12px; margin: 15px 0; }
        .info { background: #e8f4f8; border-left: 4px solid #3498db; padding: 12px; margin: 15px 0; }
        .item { margin: 10px 0; padding: 10px; background: #f8f9fa; border-radius: 5px; }
        .company { font-weight: bold; color: #2c3e50; }
        .action { color: #666; }
        .overdue { color: #ff4444; font-weight: bold; }
        .stats { display: flex; justify-content: space-around; background: #ecf0f1; padding: 15px; border-radius: 5px; margin: 20px 0; }
        .stat { text-align: center; }
        .stat-value { font-size: 24px; font-weight: bold; color: #2c3e50; }
        .stat-label { color: #7f8c8d; font-size: 12px; }
        a { color: #3498db; text-decoration: none; }
        a:hover { text-decoration: underline; }
      </style>
    </head>
    <body>
      <div class="container">
        <h1>📊 Daily Investment Report</h1>
        <p style="color: #7f8c8d;">Generated on ${today.toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}</p>
  `;

  // Summary stats
  const totalActive = categorized.all.filter(i => 
    i.properties?.['Engagement status']?.status?.name === 'Active' ||
    i.properties?.['Deal stage']?.status?.name === 'Active' ||
    (!i.properties?.['Engagement status']?.status?.name && !i.properties?.['Deal stage']?.status?.name)
  ).length;
  const actionItemsCount = categorized.overdue.length + categorized.dueToday.length;
  
  html += `
    <div class="stats">
      <div class="stat">
        <div class="stat-value">${categorized.all.length}</div>
        <div class="stat-label">TOTAL INVESTMENTS</div>
      </div>
      <div class="stat">
        <div class="stat-value">${totalActive}</div>
        <div class="stat-label">ACTIVE</div>
      </div>
      <div class="stat">
        <div class="stat-value">${actionItemsCount}</div>
        <div class="stat-label">ACTION ITEMS</div>
      </div>
    </div>
  `;

  // Overdue items
  if (categorized.overdue.length > 0) {
    html += `
      <h2>🚨 Overdue Actions (${categorized.overdue.length})</h2>
      <div class="alert">These items need immediate attention!</div>
    `;
    categorized.overdue.forEach(item => {
      const daysOverdue = daysSince(item.nextActionDate);
      html += `
        <div class="item">
          <div class="company">${item.companyName} <span class="overdue">(${daysOverdue} days overdue)</span></div>
          <div class="action">📌 ${item.nextAction}</div>
          <div style="color: #666; font-size: 14px; margin-top: 3px;">📞 Contact: ${item.poc} | 📅 Due: ${formatDate(item.nextActionDate)}</div>
          <div style="margin-top: 5px;">
            <a href="${item.url}" target="_blank">View in Notion →</a>
          </div>
        </div>
      `;
    });
  }

  // Due today
  if (categorized.dueToday.length > 0) {
    html += `
      <h2>📅 Due Today (${categorized.dueToday.length})</h2>
    `;
    categorized.dueToday.forEach(item => {
      html += `
        <div class="item">
          <div class="company">${item.companyName}</div>
          <div class="action">📌 ${item.nextAction}</div>
          <div style="color: #666; font-size: 14px; margin-top: 3px;">📞 Contact: ${item.poc} | 📅 Due: Today</div>
          <div style="margin-top: 5px;">
            <a href="${item.url}" target="_blank">View in Notion →</a>
          </div>
        </div>
      `;
    });
  }

  // This week
  if (categorized.thisWeek.length > 0) {
    html += `
      <h2>📆 This Week (${categorized.thisWeek.length})</h2>
    `;
    categorized.thisWeek.forEach(item => {
      html += `
        <div class="item">
          <div class="company">${item.companyName}</div>
          <div class="action">📌 ${item.nextAction}</div>
          <div style="color: #666; font-size: 14px; margin-top: 3px;">📞 Contact: ${item.poc} | 📅 Due: ${formatDate(item.nextActionDate)}</div>
        </div>
      `;
    });
  }

  // Upcoming this month
  if (categorized.thisMonth.length > 0) {
    html += `
      <h2>📊 Upcoming This Month (${categorized.thisMonth.length})</h2>
      <div class="info">Items scheduled in the next 30 days</div>
    `;
    // Show first 5 only
    categorized.thisMonth.slice(0, 5).forEach(item => {
      html += `
        <div class="item">
          <div class="company">${item.companyName}</div>
          <div class="action">📌 ${item.nextAction}</div>
          <div style="color: #666; font-size: 14px; margin-top: 3px;">📞 Contact: ${item.poc} | 📅 Due: ${formatDate(item.nextActionDate)}</div>
        </div>
      `;
    });
    
    if (categorized.thisMonth.length > 5) {
      html += `<p style="color: #7f8c8d; text-align: center;">... and ${categorized.thisMonth.length - 5} more</p>`;
    }
  }

  // No actions message
  if (actionItemsCount === 0 && categorized.thisWeek.length === 0) {
    html += `
      <div class="info" style="margin-top: 30px; text-align: center;">
        <h3>✅ All Clear!</h3>
        <p>No immediate action items. Enjoy your day!</p>
      </div>
    `;
  }

  html += `
        <hr style="margin-top: 40px; border: none; border-top: 1px solid #ecf0f1;">
        <p style="color: #7f8c8d; font-size: 12px; text-align: center;">
          This report was automatically generated from your Notion database.<br>
          <a href="https://notion.so/${DATABASE_ID}" target="_blank">View Full Database</a>
        </p>
      </div>
    </body>
    </html>
  `;

  return html;
}

async function sendEmail(html, categorized) {
  const actionCount = categorized.overdue.length + categorized.dueToday.length;
  const subject = actionCount > 0 
    ? `[Angel Portfolio] ${actionCount} action items need attention`
    : '[Angel Portfolio] Daily Report - All Clear';

  if (DRY_RUN) {
    console.log('=== DRY RUN MODE ===');
    console.log('To:', EMAIL_TO);
    console.log('Subject:', subject);
    console.log('Action items:', {
      overdue: categorized.overdue.length,
      dueToday: categorized.dueToday.length,
      thisWeek: categorized.thisWeek.length,
      thisMonth: categorized.thisMonth.length,
    });
    console.log('Email would be sent successfully!');
    return;
  }

  try {
    const { data, error } = await resend.emails.send({
      from: EMAIL_FROM,
      to: [EMAIL_TO],
      subject: subject,
      html: html,
    });

    if (error) {
      console.error('Error sending email:', error);
      throw error;
    }

    console.log('Email sent successfully:', data);
  } catch (error) {
    console.error('Failed to send email:', error);
    throw error;
  }
}

async function main() {
  try {
    console.log('Fetching investments from Notion...');
    const investments = await fetchInvestments();
    console.log(`Found ${investments.length} investments`);

    console.log('Categorizing investments...');
    const categorized = categorizeInvestments(investments);

    console.log('Generating email report...');
    const emailHTML = generateEmailHTML(categorized);

    console.log('Sending email...');
    await sendEmail(emailHTML, categorized);

    console.log('✅ Report sent successfully!');
  } catch (error) {
    console.error('❌ Error in main process:', error);
    process.exit(1);
  }
}

// Export functions for testing
module.exports = {
  fetchInvestments,
  categorizeInvestments,
  generateEmailHTML,
  sendEmail,
  main
};

// Run the script if called directly
if (require.main === module) {
  main();
}