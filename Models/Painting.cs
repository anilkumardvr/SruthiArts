namespace SruthiArts.Models
{
    public class Painting
    {
        public int Id { get; set; }

        // Core
        public string Title { get; set; } = "";
        public string Artist { get; set; } = "Sruthi";
        public string Description { get; set; } = "";
        public decimal Price { get; set; }
        public string ImageUrl { get; set; } = "";
        public double Rating { get; set; } = 4.8;

        // Details used by Details.cshtml
        public string Medium { get; set; } = "Acrylic on canvas";
        // dimensions in centimeters
        public int Width { get; set; } = 40;
        public int Height { get; set; } = 50;

        // Misc
        public string[] Tags { get; set; } = Array.Empty<string>();
        public int Year { get; set; } = DateTime.UtcNow.Year;
        public bool ForSale { get; set; } = true;
        public int Stock { get; set; } = 1;
    }
}
