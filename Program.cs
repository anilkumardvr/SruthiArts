using Microsoft.EntityFrameworkCore;
using SruthiArts.Data;
using SruthiArts.Models;

var builder = WebApplication.CreateBuilder(args);

builder.Services.AddRazorPages();
builder.Services.AddDbContext<ArtDbContext>(o =>
    o.UseSqlite("Data Source=arts.db"));

var app = builder.Build();

// Create & seed DB
using (var scope = app.Services.CreateScope())
{
    var db = scope.ServiceProvider.GetRequiredService<ArtDbContext>();
    db.Database.EnsureCreated();
    if (!db.Paintings.Any())
    {
        db.Paintings.AddRange(SamplePaintings());
        db.SaveChanges();
    }
}

if (!app.Environment.IsDevelopment())
{
    app.UseExceptionHandler("/Error");
    app.UseHsts();
}
app.UseHttpsRedirection();
app.UseStaticFiles();
app.UseRouting();
app.MapRazorPages();
app.Run();

// ---- ONE copy of SamplePaintings only ----
static List<Painting> SamplePaintings() => new()
{
    new Painting{
        Title="Moonlit Garden",
        Description="Soft pastel garden under a silver moon.",
        Price=249.00m,
        ImageUrl="https://images.unsplash.com/photo-1500530855697-b586d89ba3ee",
        Medium="Acrylic on canvas", Width=40, Height=50
    },
    new Painting{
        Title="Lavender Skies",
        Description="Calm gradients and dreamy clouds.",
        Price=199.00m,
        ImageUrl="https://images.unsplash.com/photo-1501785888041-af3ef285b470",
        Medium="Oil on canvas", Width=45, Height=60
    },
    new Painting{
        Title="Golden Forest",
        Description="Sun-drenched trees, warm tones.",
        Price=279.00m,
        ImageUrl="https://images.unsplash.com/photo-1441974231531-c6227db76b6e",
        Medium="Mixed media", Width=50, Height=70
    },
    new Painting{
        Title="Sea Whispers",
        Description="Aesthetic coastal blues.",
        Price=239.00m,
        ImageUrl="https://images.unsplash.com/photo-1507525428034-b723cf961d3e",
        Medium="Watercolor", Width=42, Height=56
    },
};
