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
      dealStage: item.properties['Deal stage']?.status?.name || 'Not specified',
      engagementStatus: item.properties['Engagement status']?.status?.name || 'Not specified',
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

  // Define deal stage priority order (higher number = higher priority)
  const dealStagePriority = {
    'Closing': 6,
    'Handshake': 5,
    'In progress': 4,
    'Not started': 3,
    'On hold': 2,
    'Passed': 1,
    'Invested': 1,
    'Complete': 1,
    'Not specified': 0
  };

  // Sort function to prioritize by deal stage (descending), then by days overdue (descending)
  const sortByDealStage = (a, b) => {
    const priorityA = dealStagePriority[a.dealStage] || 0;
    const priorityB = dealStagePriority[b.dealStage] || 0;
    
    if (priorityA !== priorityB) {
      return priorityB - priorityA; // Higher priority first
    }
    
    // If same deal stage, sort by days overdue (most overdue first)
    const daysA = daysSince(a.nextActionDate);
    const daysB = daysSince(b.nextActionDate);
    return daysB - daysA;
  };

  // Apply sorting to each category
  categorized.overdue.sort(sortByDealStage);
  categorized.dueToday.sort(sortByDealStage);
  categorized.thisWeek.sort(sortByDealStage);
  categorized.thisMonth.sort(sortByDealStage);

  // Function to convert deal stage to CSS class
  const getDealStageClass = (dealStage) => {
    return dealStage.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9\-]/g, '');
  };

  let html = `
    <!DOCTYPE html>
    <html>
    <head>
      <style>
        body { 
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; 
          line-height: 1.5; 
          color: #1a1a1a; 
          background: #ffffff;
          margin: 0;
          padding: 20px;
        }
        .container { 
          max-width: 600px; 
          margin: 0 auto; 
          background: white;
        }
        .header {
          margin-bottom: 32px;
        }
        h1 { 
          font-size: 28px;
          font-weight: 700;
          color: #1a1a1a;
          margin: 0 0 8px 0;
          line-height: 1.2;
        }
        .date {
          font-size: 16px;
          color: #6b7280;
          margin: 0;
          font-weight: 400;
        }
        .section {
          margin-bottom: 32px;
        }
        .section-title {
          font-size: 20px;
          font-weight: 600;
          color: #1a1a1a;
          margin: 0 0 16px 0;
          display: flex;
          align-items: center;
          gap: 8px;
        }
        .count {
          background: #f3f4f6;
          color: #6b7280;
          font-size: 14px;
          font-weight: 500;
          padding: 2px 8px;
          border-radius: 12px;
        }
        .overdue-count {
          background: #fef2f2;
          color: #dc2626;
        }
        .today-count {
          background: #fffbeb;
          color: #d97706;
        }
        .company-item {
          background: #ffffff;
          border: 1px solid #e5e7eb;
          border-radius: 8px;
          padding: 16px;
          margin-bottom: 12px;
          border-left: 4px solid #e5e7eb;
        }
        .company-item.closing {
          border-left-color: #3b82f6;
          background: #f8faff;
        }
        .company-item.handshake {
          border-left-color: #3b82f6;
          background: #f8faff;
        }
        .company-item.in-progress {
          border-left-color: #f59e0b;
          background: #fffbf0;
        }
        .company-item.not-started {
          border-left-color: #6b7280;
          background: #f9fafb;
        }
        .company-item.on-hold {
          border-left-color: #92400e;
          background: #fef3e2;
        }
        .company-item.passed {
          border-left-color: #92400e;
          background: #fef3e2;
        }
        .company-item.invested {
          border-left-color: #10b981;
          background: #f0fdf9;
        }
        .company-item.complete {
          border-left-color: #10b981;
          background: #f0fdf9;
        }
        .company-header {
          display: flex;
          justify-content: space-between;
          align-items: flex-start;
          margin-bottom: 8px;
        }
        .company-name {
          font-size: 16px;
          font-weight: 600;
          color: #1a1a1a;
          margin: 0;
        }
        .overdue-badge {
          background: #fef2f2;
          color: #dc2626;
          font-size: 12px;
          font-weight: 500;
          padding: 2px 6px;
          border-radius: 4px;
          white-space: nowrap;
        }
        .action-text {
          color: #4b5563;
          font-size: 14px;
          margin: 8px 0;
          line-height: 1.4;
        }
        .meta-info {
          display: flex;
          flex-wrap: wrap;
          gap: 12px;
          font-size: 13px;
          color: #6b7280;
          margin-top: 12px;
        }
        .meta-item {
          display: flex;
          align-items: center;
          gap: 4px;
          white-space: nowrap;
        }
        .meta-label {
          font-weight: 500;
          color: #4b5563;
        }
        @media (max-width: 600px) {
          .container {
            padding: 12px;
          }
          .company-item {
            padding: 12px;
          }
          .company-header {
            flex-direction: column;
            gap: 8px;
            align-items: flex-start;
          }
          .overdue-badge {
            align-self: flex-start;
          }
          .company-name {
            font-size: 15px;
          }
          .action-text {
            font-size: 13px;
          }
          .meta-info {
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: 8px;
            margin-top: 12px;
          }
          .view-link {
            grid-column: 1 / -1;
            justify-self: start;
            margin-top: 4px;
          }
        }
        @media (max-width: 480px) {
          .meta-info {
            display: flex;
            flex-direction: column;
            gap: 6px;
            align-items: flex-start;
          }
          .meta-item {
            width: 100%;
            justify-content: flex-start;
          }
          .view-link {
            margin-top: 8px;
          }
        }
        .view-link {
          color: #3b82f6;
          text-decoration: none;
          font-size: 13px;
          font-weight: 500;
        }
        .view-link:hover {
          text-decoration: underline;
        }
        .empty-state {
          text-align: center;
          padding: 32px;
          color: #6b7280;
        }
        .empty-state h3 {
          color: #10b981;
          margin: 0 0 8px 0;
        }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="header">
          <h1>Daily Investment Report</h1>
          <p class="date">${today.toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}</p>
        </div>
  `;


  // Overdue items
  if (categorized.overdue.length > 0) {
    html += `
        <div class="section">
          <h2 class="section-title">
            🚨 Overdue Actions
            <span class="count overdue-count">${categorized.overdue.length}</span>
          </h2>
    `;
    categorized.overdue.forEach(item => {
      const daysOverdue = daysSince(item.nextActionDate);
      html += `
          <div class="company-item ${getDealStageClass(item.dealStage)}">
            <div class="company-header">
              <h3 class="company-name">${item.companyName}</h3>
              <span class="overdue-badge">${daysOverdue} days overdue</span>
            </div>
            <div class="action-text"><strong>Next action:</strong> ${item.nextAction}</div>
            <div class="meta-info">
              <div class="meta-item">📞 <span class="meta-label">Contact:</span> ${item.poc}</div>
              <div class="meta-item">📅 <span class="meta-label">Due:</span> ${formatDate(item.nextActionDate)}</div>
              <div class="meta-item">📈 <span class="meta-label">Deal:</span> ${item.dealStage}</div>
              <div class="meta-item">🔄 <span class="meta-label">Status:</span> ${item.engagementStatus}</div>
              <a href="${item.url}" target="_blank" class="view-link">View in Notion →</a>
            </div>
          </div>
      `;
    });
    html += `</div>`;
  }

  // Due today
  if (categorized.dueToday.length > 0) {
    html += `
        <div class="section">
          <h2 class="section-title">
            📅 Due Today
            <span class="count today-count">${categorized.dueToday.length}</span>
          </h2>
    `;
    categorized.dueToday.forEach(item => {
      html += `
          <div class="company-item ${getDealStageClass(item.dealStage)}">
            <div class="company-header">
              <h3 class="company-name">${item.companyName}</h3>
            </div>
            <div class="action-text"><strong>Next action:</strong> ${item.nextAction}</div>
            <div class="meta-info">
              <div class="meta-item">📞 ${item.poc}</div>
              <div class="meta-item">📅 <span class="meta-label">Due:</span> Today</div>
              <div class="meta-item">📈 ${item.dealStage}</div>
              <div class="meta-item">🔄 ${item.engagementStatus}</div>
              <a href="${item.url}" target="_blank" class="view-link">View in Notion →</a>
            </div>
          </div>
      `;
    });
    html += `</div>`;
  }

  // This week
  if (categorized.thisWeek.length > 0) {
    html += `
        <div class="section">
          <h2 class="section-title">
            📆 This Week
            <span class="count">${categorized.thisWeek.length}</span>
          </h2>
    `;
    categorized.thisWeek.forEach(item => {
      html += `
          <div class="company-item ${getDealStageClass(item.dealStage)}">
            <div class="company-header">
              <h3 class="company-name">${item.companyName}</h3>
            </div>
            <div class="action-text"><strong>Next action:</strong> ${item.nextAction}</div>
            <div class="meta-info">
              <div class="meta-item">📞 <span class="meta-label">Contact:</span> ${item.poc}</div>
              <div class="meta-item">📅 <span class="meta-label">Due:</span> ${formatDate(item.nextActionDate)}</div>
              <div class="meta-item">📈 <span class="meta-label">Deal:</span> ${item.dealStage}</div>
              <div class="meta-item">🔄 <span class="meta-label">Status:</span> ${item.engagementStatus}</div>
              <a href="${item.url}" target="_blank" class="view-link">View in Notion →</a>
            </div>
          </div>
      `;
    });
    html += `</div>`;
  }

  // Upcoming this month
  if (categorized.thisMonth.length > 0) {
    html += `
        <div class="section">
          <h2 class="section-title">
            📊 This Month
            <span class="count">${categorized.thisMonth.length}</span>
          </h2>
    `;
    // Show first 5 only
    categorized.thisMonth.slice(0, 5).forEach(item => {
      html += `
          <div class="company-item ${getDealStageClass(item.dealStage)}">
            <div class="company-header">
              <h3 class="company-name">${item.companyName}</h3>
            </div>
            <div class="action-text"><strong>Next action:</strong> ${item.nextAction}</div>
            <div class="meta-info">
              <div class="meta-item">📞 <span class="meta-label">Contact:</span> ${item.poc}</div>
              <div class="meta-item">📅 <span class="meta-label">Due:</span> ${formatDate(item.nextActionDate)}</div>
              <div class="meta-item">📈 <span class="meta-label">Deal:</span> ${item.dealStage}</div>
              <div class="meta-item">🔄 <span class="meta-label">Status:</span> ${item.engagementStatus}</div>
              <a href="${item.url}" target="_blank" class="view-link">View in Notion →</a>
            </div>
          </div>
      `;
    });
    
    if (categorized.thisMonth.length > 5) {
      html += `<p style="color: #6b7280; text-align: center; margin-top: 16px;">... and ${categorized.thisMonth.length - 5} more</p>`;
    }
    html += `</div>`;
  }

  // No actions message
  const actionItemsCount = categorized.overdue.length + categorized.dueToday.length;
  if (actionItemsCount === 0 && categorized.thisWeek.length === 0) {
    html += `
        <div class="empty-state">
          <h3>✅ All Clear!</h3>
          <p>No immediate action items. Enjoy your day!</p>
        </div>
    `;
  }

  html += `
        <div style="margin-top: 48px; padding-top: 24px; border-top: 1px solid #e5e7eb; text-align: center;">
          <p style="color: #6b7280; font-size: 13px; margin: 0;">
            Generated from your <a href="https://notion.so/${DATABASE_ID}" target="_blank" style="color: #3b82f6;">Notion database</a>
          </p>
        </div>
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