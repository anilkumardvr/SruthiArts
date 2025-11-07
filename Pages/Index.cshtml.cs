using Microsoft.AspNetCore.Mvc.RazorPages;
using Microsoft.EntityFrameworkCore;
using SruthiArts.Data;
using SruthiArts.Models;

namespace SruthiArts.Pages
{
    public class IndexModel : PageModel
    {
        private readonly ArtDbContext _db;
        public IndexModel(ArtDbContext db) => _db = db;

        public List<Painting> Paintings { get; private set; } = new();

        public async Task OnGet()
        {
            Paintings = await _db.Paintings
                                 .OrderByDescending(p => p.Id)
                                 .ToListAsync();
        }
    }
}
