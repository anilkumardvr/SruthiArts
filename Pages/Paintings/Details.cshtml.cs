using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.RazorPages;
using Microsoft.EntityFrameworkCore;
using SruthiArts.Data;
using SruthiArts.Models;

namespace SruthiArts.Pages.Paintings
{
    public class DetailsModel : PageModel
    {
        private readonly ArtDbContext _db;
        public DetailsModel(ArtDbContext db) => _db = db;

        [BindProperty(SupportsGet = true)]
        public int Id { get; set; }

        public Painting? Painting { get; private set; }

        public async Task<IActionResult> OnGetAsync()
        {
            Painting = await _db.Paintings.FirstOrDefaultAsync(p => p.Id == Id);
            if (Painting == null) return RedirectToPage("/Index");
            return Page();
        }
    }
}
