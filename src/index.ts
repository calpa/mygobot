import { Hono } from 'hono';
import { Bot, webhookCallback, InlineKeyboard } from 'grammy';
import data from './data.json';

// Define environment variable types for Cloudflare Workers
type Env = {
  BOT_TOKEN: string;
  IMAGE_HOST: string;
};

// Store search results for callback queries
const userResults = new Map<number, string[]>();
// Store pagination state for each user
const userPagination = new Map<number, number>();
// Number of results to show per page
const RESULTS_PER_PAGE = 10;

// Helper function to extract only the text content from the result
function extractTextContent(item: string): string {
  // Extract only the text content after the episode and scene numbers
  const match = item.match(/ep\d+_\d+_(.+)/)
  if (!match) return item;
  
  return match[1];
}

// Helper function to get the image URL from Cloudflare R2
function getImageUrl(item: string, imageHost: string): string {
  return `${imageHost}/bandori_family_${item}.jpg`;
}

// Create a Hono app with typed environment
const app = new Hono<{ Bindings: Env }>();

// Health check endpoint
app.get('/', (c) => c.text('MyGO!!!!! Bot 正在運行中！'));

// Webhook endpoint for Telegram
app.post('/webhook', async (c) => {
  // Create a bot instance using the BOT_TOKEN from environment variables
  const bot = new Bot(c.env.BOT_TOKEN);

  // Handle the /start command
  bot.command('start', (ctx) => {
    return ctx.reply('👋 正在運行中！發送關鍵字來搜尋 MyGO!!!!! 圖片。');
  });

  // Handle the /help command
  bot.command('help', (ctx) => {
    return ctx.reply('發送任何關鍵字，我將搜尋匹配的 MyGO!!!!! 圖片。例如，嘗試發送 "小祥" 或 "愛音"。');
  });

  // Handle text messages for searching
  bot.on('message:text', async (ctx) => {
    const query = ctx.message.text.toLowerCase();
    const userId = ctx.from?.id;
    
    // Search for matches in the data
    const results = data.filter(item => 
      item.toLowerCase().includes(query)
    );
    
    // Store results for this user for callback handling
    if (userId) {
      userResults.set(userId, results);
    }
    
    if (results.length === 0) {
      return ctx.reply('找不到匹配的結果。請嘗試其他關鍵字！');
    }
    
    // If there's only one result, reply with the image
    if (results.length === 1) {
      const textContent = extractTextContent(results[0]);
      const imageUrl = getImageUrl(results[0], c.env.IMAGE_HOST);
      return ctx.replyWithPhoto(imageUrl, {
        caption: textContent
      });
    }
    
    // Initialize pagination for this user
    if (userId) {
      userPagination.set(userId, 0); // Start at page 0
    }
    
    // Calculate total pages
    const totalPages = Math.ceil(results.length / RESULTS_PER_PAGE);
    
    // Get first page of results
    const startIdx = 0;
    const endIdx = Math.min(RESULTS_PER_PAGE, results.length);
    const pageResults = results.slice(startIdx, endIdx);
    
    const keyboard = new InlineKeyboard();
    
    // Add each result as a button, showing only the text content
    pageResults.forEach((item, index) => {
      const textContent = extractTextContent(item);
      keyboard.text(textContent, `result_${index}`).row();
    });
    
    // Add pagination buttons if there are more than one page
    if (totalPages > 1) {
      keyboard.text('⬅️ 上一頁', 'prev_page')
             .text(`(1/${totalPages})`, 'page_info')
             .text('下一頁 ➡️', 'next_page');
    }
    
    // Format the results message
    const message = `找到 ${results.length} 個匹配結果。以下是第 1 頁，共 ${totalPages} 頁：`;
    
    return ctx.reply(message, { reply_markup: keyboard });
  });

  // Handle callback queries (button clicks)
  bot.on('callback_query:data', async (ctx) => {
    const callbackData = ctx.callbackQuery.data;
    const userId = ctx.from?.id;
    
    // Get the user's search results
    const userSearchResults = userId ? userResults.get(userId) : undefined;
    
    // Handle result selection
    if (callbackData.startsWith('result_') && userSearchResults) {
      const index = parseInt(callbackData.split('_')[1]);
      // Show the image when a button is clicked
      if (index >= 0 && index < userSearchResults.length) {
        const selectedResult = userSearchResults[index];
        const textContent = extractTextContent(selectedResult);
        const imageUrl = getImageUrl(selectedResult, c.env.IMAGE_HOST);
        await ctx.replyWithPhoto(imageUrl, {
          caption: textContent
        });
      }
      await ctx.answerCallbackQuery();
    }
    // Handle pagination
    else if (callbackData === 'prev_page' || callbackData === 'next_page' || callbackData === 'page_info') {
      if (!userId) {
        await ctx.answerCallbackQuery({ text: '無法識別用戶' });
        return;
      }
      
      const results = userResults.get(userId);
      
      if (!results || results.length === 0) {
        await ctx.answerCallbackQuery({ text: '沒有搜尋結果' });
        return;
      }
      
      // Calculate total pages
      const totalPages = Math.ceil(results.length / RESULTS_PER_PAGE);
      
      // Get current page
      let currentPage = userPagination.get(userId) || 0;
      
      // Handle page navigation
      if (callbackData === 'prev_page') {
        currentPage = Math.max(0, currentPage - 1);
        userPagination.set(userId, currentPage);
      } else if (callbackData === 'next_page') {
        currentPage = Math.min(totalPages - 1, currentPage + 1);
        userPagination.set(userId, currentPage);
      } else if (callbackData === 'page_info') {
        await ctx.answerCallbackQuery({ text: `第 ${currentPage + 1} 頁，共 ${totalPages} 頁` });
        return;
      }
      
      // Calculate start and end indices for current page
      const startIdx = currentPage * RESULTS_PER_PAGE;
      const endIdx = Math.min(startIdx + RESULTS_PER_PAGE, results.length);
      const pageResults = results.slice(startIdx, endIdx);
      
      // Create keyboard for current page
      const keyboard = new InlineKeyboard();
      
      // Add each result as a button
      pageResults.forEach((item, pageIndex) => {
        const actualIndex = startIdx + pageIndex; // Calculate the actual index in the full results array
        const textContent = extractTextContent(item);
        keyboard.text(textContent, `result_${actualIndex}`).row();
      });

      // Add pagination buttons
      keyboard.text('⬅️ 上一頁', 'prev_page')
             .text(`(${currentPage + 1}/${totalPages})`, 'page_info')
             .text('下一頁 ➡️', 'next_page');
      
      // Update the message text and keyboard
      await ctx.editMessageText(`找到 ${results.length} 個匹配結果。以下是第 ${currentPage + 1} 頁，共 ${totalPages} 頁：`, {
        reply_markup: keyboard
      });
      
      await ctx.answerCallbackQuery();
    }
  });

  // Use the webhookCallback to handle the webhook request
  const handler = webhookCallback(bot, 'hono');
  return await handler(c);
});

// Export the Hono app for Cloudflare Workers
export default app;
